/**
 * SyncBridge.ts — pipes the existing P2PManager transport into the C++ engine.
 *
 * Matches P2PManager's REAL API: sendEvent(type, payload) for output, and a
 * single onMessage callback for input (there is no per-type .on()). Wire it up
 * by calling bridge.handleMessage(msg) from the P2PConfig.onMessage handler.
 *
 * Timestamping discipline — this is how far JS can go toward fixing the
 * clock-jitter problem: capture t2/t4 on the FIRST LINE of the receive path
 * and t1 IMMEDIATELY before the send call. Whatever stall the timestamps
 * cannot see, the C++ min-RTT + Theil–Sen estimator absorbs.
 */
import { P2PManager, MessageType, type P2PMessage } from '../engine/P2PManager';
import { engine, nowSeconds, type WireContact } from './NativeEngine';

const SYNC_INTERVAL_MS = 1500;
const MAX_PENDING = 32;

export class SyncBridge {
  private timer?: ReturnType<typeof setInterval>;
  private pending = new Map<number, number>(); // seq -> t1 (local seconds)
  private seq = 0;

  constructor(private p2p: P2PManager) {}

  /**
   * Route every inbound P2P message here.
   *   new P2PManager({ ..., onMessage: (m) => bridge.handleMessage(m) })
   * Returns true if the bridge consumed the message.
   */
  handleMessage(m: P2PMessage): boolean {
    switch (m.type) {
      case MessageType.SYNC_REQ: {
        const t2 = nowSeconds();                    // FIRST LINE: tightest t2
        this.p2p.sendEvent(MessageType.SYNC_RESP, {
          seq: m.payload.seq as number,
          t2,
          t3: nowSeconds(),                         // LAST LINE: tightest t3
        });
        return true;
      }
      case MessageType.SYNC_RESP: {
        const t4 = nowSeconds();                    // FIRST LINE: tightest t4
        const seq = m.payload.seq as number;
        const t1 = this.pending.get(seq);
        this.pending.delete(seq);
        if (t1 !== undefined) {
          engine().feedSyncSample(
            t1, m.payload.t2 as number, m.payload.t3 as number, t4);
        }
        return true;
      }
      case MessageType.BOUNCE_EVENT: {
        const c = m.payload as unknown as WireContact;
        engine().feedRemoteContact(c.t, c.tSigma, c.x, c.y,
          c.covXX, c.covXY, c.covYY, c.evidenceZ, c.parallaxCorrected);
        return true;
      }
      default:
        return false;                              // caller handles the rest
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      if (!this.p2p.isConnected()) return;
      const seq = this.seq++;
      if (this.pending.size >= MAX_PENDING) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
      const t1 = nowSeconds();                     // IMMEDIATELY before send
      this.pending.set(seq, t1);
      this.p2p.sendEvent(MessageType.SYNC_REQ, { seq });
    }, SYNC_INTERVAL_MS);
  }

  /** Ship this device's contact estimates to the peer. Called from the poll loop. */
  sendOutbound(contacts: WireContact[]): void {
    for (const c of contacts) {
      this.p2p.sendEvent(MessageType.BOUNCE_EVENT,
        c as unknown as Record<string, unknown>);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }
}
