/**
 * ClockSync.ts
 *
 * NTP-like clock synchronization protocol for aligning the monotonic clocks
 * of two PickleJudge devices to sub-5ms accuracy over a local Wi-Fi P2P link.
 *
 * Algorithm:
 *   Uses the classic 4-timestamp NTP offset calculation:
 *     t1 = Master sends SYNC_REQ (Master's monotonic clock)
 *     t2 = Slave receives SYNC_REQ (Slave's monotonic clock)
 *     t3 = Slave sends SYNC_RESP (Slave's monotonic clock)
 *     t4 = Master receives SYNC_RESP (Master's monotonic clock)
 *
 *     offset = ((t2 - t1) + (t3 - t4)) / 2
 *     RTT    = (t4 - t1) - (t3 - t2)
 *
 *   The Slave applies `offset` to its local clock to produce a "synced" time
 *   that matches the Master's reference frame.
 *
 * Filtering:
 *   - Runs multiple sync rounds (10 initial, then 1 every 5 seconds)
 *   - Discards the top 30% highest-RTT samples (network jitter outliers)
 *   - Uses the median offset from remaining samples for robustness
 *
 * Usage:
 *   Both devices use `getSyncedTimestamp()` to get a common time reference
 *   for tagging frames and bounce events.
 */

import { P2PManager, MessageType, type P2PMessage, DeviceRole } from './P2PManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncRound {
  t1: number; // Master send time
  t2: number; // Slave receive time
  t3: number; // Slave send time
  t4: number; // Master receive time
  offset: number; // Computed offset
  rtt: number; // Round-trip time
}

export interface ClockSyncState {
  synced: boolean;
  offset: number; // Milliseconds to add to local clock
  rtt: number; // Latest RTT measurement
  driftRate: number; // Clock drift in ms/s (for compensation)
  accuracy: number; // Estimated accuracy in ms
  roundsCompleted: number;
}

export interface ClockSyncConfig {
  initialRounds: number; // Number of sync rounds during initialization
  maintenanceIntervalMs: number; // Interval between maintenance sync pulses
  outlierPercentile: number; // Top % of RTT samples to discard
  maxAcceptableRttMs: number; // Discard rounds with RTT above this
  lockThresholdMs: number; // Consider "locked" if accuracy is below this
}

const DEFAULT_CONFIG: ClockSyncConfig = {
  initialRounds: 10,
  maintenanceIntervalMs: 5000, // 5 seconds
  outlierPercentile: 0.3, // Discard top 30%
  maxAcceptableRttMs: 50, // Ignore RTTs over 50ms (unusual for local Wi-Fi)
  lockThresholdMs: 5, // Locked when accuracy < 5ms
};

// ---------------------------------------------------------------------------
// ClockSync
// ---------------------------------------------------------------------------

export class ClockSync {
  private p2p: P2PManager;
  private role: DeviceRole;
  private config: ClockSyncConfig;

  // Sync state
  private rounds: SyncRound[] = [];
  private currentOffset: number = 0;
  private driftRate: number = 0;
  private synced: boolean = false;
  private accuracy: number = Infinity;

  // Timing for ongoing maintenance
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSyncT1: number = 0; // Master's t1 awaiting response
  private lastSyncTime: number = 0;

  // Drift tracking (for long-running sessions)
  private driftHistory: Array<{ time: number; offset: number }> = [];

  // Callback when sync state changes
  public onSyncStateChange: ((state: ClockSyncState) => void) | null = null;

  constructor(
    p2p: P2PManager,
    role: DeviceRole,
    config: Partial<ClockSyncConfig> = {},
  ) {
    this.p2p = p2p;
    this.role = role;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the clock synchronization process.
   * Master initiates sync rounds; Slave responds to them.
   */
  async startSync(): Promise<void> {
    if (this.role === DeviceRole.MASTER) {
      await this.runInitialSync();
      this.startMaintenanceSync();
    }
    // Slave just responds to incoming SYNC_REQ messages —
    // handled by handleMessage() called from P2PManager
  }

  /**
   * Handle an incoming P2P message related to clock sync.
   * Must be called by the application's message handler.
   */
  handleMessage(message: P2PMessage): void {
    switch (message.type) {
      case MessageType.SYNC_REQ:
        this.handleSyncRequest(message);
        break;
      case MessageType.SYNC_RESP:
        this.handleSyncResponse(message);
        break;
      case MessageType.CLOCK_LOCKED:
        this.handleClockLocked(message);
        break;
    }
  }

  /**
   * Get the current synchronized timestamp.
   * Both devices calling this simultaneously should return approximately
   * the same value (within the accuracy margin).
   *
   * Master: returns its own monotonic time (it's the reference)
   * Slave: returns its monotonic time + computed offset
   */
  getSyncedTimestamp(): number {
    if (this.role === DeviceRole.MASTER) {
      return performance.now();
    }

    // Apply offset + drift compensation
    const now = performance.now();
    const timeSinceLastSync = now - this.lastSyncTime;
    const driftCompensation = this.driftRate * (timeSinceLastSync / 1000.0);

    return now + this.currentOffset + driftCompensation;
  }

  /**
   * Get the current sync state.
   */
  getState(): ClockSyncState {
    return {
      synced: this.synced,
      offset: this.currentOffset,
      rtt: this.rounds.length > 0 ? this.rounds[this.rounds.length - 1].rtt : 0,
      driftRate: this.driftRate,
      accuracy: this.accuracy,
      roundsCompleted: this.rounds.length,
    };
  }

  /**
   * Check if the clock is synchronized.
   */
  isSynced(): boolean {
    return this.synced;
  }

  // -------------------------------------------------------------------------
  // Master: Sync initiation
  // -------------------------------------------------------------------------

  /**
   * Run the initial batch of sync rounds.
   */
  private async runInitialSync(): Promise<void> {
    console.log(`[ClockSync] Starting initial sync (${this.config.initialRounds} rounds)`);

    for (let i = 0; i < this.config.initialRounds; i++) {
      await this.sendSyncRequest();
      // Wait for response (give 100ms timeout per round)
      await this.delay(100);
    }

    // Compute offset from collected rounds
    this.computeOffset();

    // Notify slave of the computed offset
    this.p2p.sendEvent(MessageType.CLOCK_LOCKED, {
      offset: this.currentOffset,
      driftRate: this.driftRate,
      accuracy: this.accuracy,
      masterTime: performance.now(),
    });

    console.log(
      `[ClockSync] Initial sync complete. Offset: ${this.currentOffset.toFixed(2)}ms, ` +
      `Accuracy: ±${this.accuracy.toFixed(2)}ms, Rounds: ${this.rounds.length}`,
    );
  }

  /**
   * Send a SYNC_REQ to the Slave.
   */
  private sendSyncRequest(): Promise<void> {
    this.pendingSyncT1 = performance.now();

    this.p2p.sendEvent(MessageType.SYNC_REQ, {
      t1: this.pendingSyncT1,
      roundIndex: this.rounds.length,
    });

    return Promise.resolve();
  }

  /**
   * Start periodic maintenance sync to compensate for clock drift.
   */
  private startMaintenanceSync(): void {
    this.maintenanceTimer = setInterval(() => {
      this.sendSyncRequest().then(() => {
        // After collecting the response, recompute offset
        setTimeout(() => this.computeOffset(), 200);
      });
    }, this.config.maintenanceIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Slave: Respond to sync requests
  // -------------------------------------------------------------------------

  /**
   * Handle incoming SYNC_REQ (Slave side).
   * Immediately respond with t2 (receive time) and t3 (send time).
   */
  private handleSyncRequest(message: P2PMessage): void {
    const t2 = performance.now(); // Slave's receive timestamp
    const t1 = message.payload.t1 as number;

    // Respond immediately — minimize processing delay between t2 and t3
    const t3 = performance.now(); // Slave's send timestamp

    this.p2p.sendEvent(MessageType.SYNC_RESP, {
      t1, // Echo back Master's t1
      t2,
      t3,
      roundIndex: message.payload.roundIndex,
    });
  }

  /**
   * Handle incoming SYNC_RESP (Master side).
   * Compute offset and RTT for this round.
   */
  private handleSyncResponse(message: P2PMessage): void {
    const t4 = performance.now(); // Master's receive timestamp
    const t1 = message.payload.t1 as number;
    const t2 = message.payload.t2 as number;
    const t3 = message.payload.t3 as number;

    const rtt = (t4 - t1) - (t3 - t2);
    const offset = ((t2 - t1) + (t3 - t4)) / 2;

    // Discard rounds with unusually high RTT
    if (rtt > this.config.maxAcceptableRttMs) {
      console.log(`[ClockSync] Discarding round with high RTT: ${rtt.toFixed(1)}ms`);
      return;
    }

    this.rounds.push({ t1, t2, t3, t4, offset, rtt });
    this.lastSyncTime = performance.now();
  }

  /**
   * Handle CLOCK_LOCKED from Master (Slave side).
   * The Master has computed and shared the final offset.
   */
  private handleClockLocked(message: P2PMessage): void {
    this.currentOffset = message.payload.offset as number;
    this.driftRate = message.payload.driftRate as number;
    this.accuracy = message.payload.accuracy as number;
    this.synced = true;
    this.lastSyncTime = performance.now();

    console.log(
      `[ClockSync] Slave received CLOCK_LOCKED. Offset: ${this.currentOffset.toFixed(2)}ms`,
    );

    this.onSyncStateChange?.(this.getState());
  }

  // -------------------------------------------------------------------------
  // Offset Computation
  // -------------------------------------------------------------------------

  /**
   * Compute the clock offset using filtered median of collected rounds.
   */
  private computeOffset(): void {
    if (this.rounds.length < 3) return;

    // Step 1: Sort by RTT (ascending)
    const sorted = [...this.rounds].sort((a, b) => a.rtt - b.rtt);

    // Step 2: Discard the top outlierPercentile% (highest RTT = most jitter)
    const keepCount = Math.max(
      3,
      Math.ceil(sorted.length * (1 - this.config.outlierPercentile)),
    );
    const filtered = sorted.slice(0, keepCount);

    // Step 3: Compute median offset (more robust than mean)
    const offsets = filtered.map(r => r.offset).sort((a, b) => a - b);
    const medianIdx = Math.floor(offsets.length / 2);
    const medianOffset =
      offsets.length % 2 === 0
        ? (offsets[medianIdx - 1] + offsets[medianIdx]) / 2
        : offsets[medianIdx];

    // Step 4: Estimate accuracy as half the IQR of remaining offsets
    const q1Idx = Math.floor(offsets.length * 0.25);
    const q3Idx = Math.floor(offsets.length * 0.75);
    const iqr = offsets[q3Idx] - offsets[q1Idx];
    this.accuracy = iqr / 2;

    // Step 5: Track drift over time
    const previousOffset = this.currentOffset;
    this.currentOffset = medianOffset;

    if (this.driftHistory.length > 0) {
      const lastDrift = this.driftHistory[this.driftHistory.length - 1];
      const timeDelta = (performance.now() - lastDrift.time) / 1000.0; // seconds
      if (timeDelta > 1) {
        this.driftRate = (medianOffset - lastDrift.offset) / timeDelta;
      }
    }
    this.driftHistory.push({
      time: performance.now(),
      offset: medianOffset,
    });

    // Keep drift history manageable
    if (this.driftHistory.length > 100) {
      this.driftHistory = this.driftHistory.slice(-50);
    }

    // Check if we've achieved lock
    this.synced = this.accuracy < this.config.lockThresholdMs;

    this.onSyncStateChange?.(this.getState());
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Stop synchronization and clean up timers.
   */
  destroy(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    this.rounds = [];
    this.driftHistory = [];
  }

  /**
   * Utility: async delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
