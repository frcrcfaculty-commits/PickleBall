/**
 * P2PManager.ts
 *
 * WebRTC DataChannel manager for local peer-to-peer communication between
 * two PickleJudge devices. No STUN/TURN servers — operates entirely over
 * local Wi-Fi using host ICE candidates only.
 *
 * Architecture:
 *   - Master device creates the RTCPeerConnection and DataChannel
 *   - Slave device receives the DataChannel via the 'datachannel' event
 *   - Signaling (SDP/ICE exchange) happens over local TCP via SignalingBridge
 *   - Once DataChannel opens, all traffic is direct P2P
 *
 * Message Protocol:
 *   All messages are JSON-encoded with a `type` discriminator field.
 *   See MessageType enum for all supported message types.
 */

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
} from 'react-native-webrtc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum DeviceRole {
  MASTER = 'MASTER',
  SLAVE = 'SLAVE',
}

export enum MessageType {
  // Clock synchronization
  SYNC_REQ = 'SYNC_REQ',
  SYNC_RESP = 'SYNC_RESP',
  CLOCK_LOCKED = 'CLOCK_LOCKED',

  // Calibration
  CALIBRATION_SYNC = 'CALIBRATION_SYNC',
  CALIBRATION_ACK = 'CALIBRATION_ACK',

  // Game events
  OUT_EVENT = 'OUT_EVENT',
  IN_EVENT = 'IN_EVENT',
  BOUNCE_EVENT = 'BOUNCE_EVENT',

  // Session management
  SESSION_START = 'SESSION_START',
  SESSION_END = 'SESSION_END',
  PING = 'PING',
  PONG = 'PONG',

  // Thermal state
  THERMAL_STATE = 'THERMAL_STATE',
}

export interface P2PMessage {
  type: MessageType;
  payload: Record<string, unknown>;
  sentAt: number; // performance.now() timestamp
}

export interface P2PConfig {
  role: DeviceRole;
  onMessage: (message: P2PMessage) => void;
  onConnectionStateChange: (state: string) => void;
  onError: (error: Error) => void;
}

export interface ConnectionStats {
  rtt: number; // Latest round-trip time (ms)
  messagessSent: number;
  messagesReceived: number;
  bytessSent: number;
  bytesReceived: number;
  connectionUptime: number; // ms since DataChannel opened
}

// ---------------------------------------------------------------------------
// P2PManager
// ---------------------------------------------------------------------------

export class P2PManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: any = null; // RTCDataChannel
  private config: P2PConfig;
  private connected: boolean = false;
  private connectionStartTime: number = 0;
  private stats: ConnectionStats = {
    rtt: 0,
    messagessSent: 0,
    messagesReceived: 0,
    bytessSent: 0,
    bytesReceived: 0,
    connectionUptime: 0,
  };

  // Reconnection
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private destroyed: boolean = false;

  constructor(config: P2PConfig) {
    this.config = config;
  }

  /**
   * Initialize the RTCPeerConnection with local-only ICE configuration.
   * No STUN/TURN servers — we only want host candidates on the local network.
   */
  async initialize(): Promise<void> {
    // ICE configuration: empty = only host candidates (local IP)
    // This ensures zero cloud dependency for NAT traversal
    const iceConfig = {
      iceServers: [], // No STUN/TURN — local network only
      iceCandidatePoolSize: 0,
      iceTransportPolicy: 'all' as const,
    };

    this.pc = new RTCPeerConnection(iceConfig);

    // ICE candidate handler — only local/host candidates
    this.pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        // Filter: only accept host candidates (local IPs)
        const candidateStr = event.candidate.candidate;
        if (candidateStr.includes('typ host')) {
          // Emit this candidate for signaling exchange
          this.onLocalIceCandidate?.(event.candidate);
        }
        // Ignore srflx (STUN) and relay (TURN) candidates
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState ?? 'unknown';
      this.config.onConnectionStateChange(state);

      if (state === 'disconnected' || state === 'failed') {
        this.handleDisconnection();
      }
    };

    if (this.config.role === DeviceRole.MASTER) {
      // Master creates the DataChannel
      this.createDataChannel();
    } else {
      // Slave listens for incoming DataChannel
      this.pc.ondatachannel = (event: any) => {
        this.setupDataChannel(event.channel);
      };
    }
  }

  /**
   * Create the DataChannel (Master only).
   * Configured for low-latency unreliable delivery (UDP-like).
   */
  private createDataChannel(): void {
    if (!this.pc) return;

    // 'pickle-sync' channel with UDP-like settings for minimum latency
    const channelConfig = {
      ordered: false, // Don't wait for ordering — lower latency
      maxRetransmits: 0, // No retransmission — fire and forget
      protocol: 'picklejudge-v1',
    };

    this.dataChannel = this.pc.createDataChannel('pickle-sync', channelConfig);
    this.setupDataChannel(this.dataChannel);
  }

  /**
   * Set up event handlers on the DataChannel.
   */
  private setupDataChannel(channel: any): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      this.connected = true;
      this.connectionStartTime = performance.now();
      this.reconnectAttempts = 0;
      console.log('[P2P] DataChannel OPEN');
      this.config.onConnectionStateChange('connected');

      // Send initial handshake
      this.send({
        type: MessageType.SESSION_START,
        payload: {
          role: this.config.role,
          protocolVersion: '1.0',
          deviceInfo: {
            platform: require('react-native').Platform.OS,
          },
        },
        sentAt: performance.now(),
      });
    };

    channel.onmessage = (event: any) => {
      try {
        const message: P2PMessage = JSON.parse(event.data);
        this.stats.messagesReceived++;
        this.stats.bytesReceived += event.data.length;

        // Handle internal PING/PONG for RTT measurement
        if (message.type === MessageType.PING) {
          this.send({
            type: MessageType.PONG,
            payload: { echoTimestamp: message.sentAt },
            sentAt: performance.now(),
          });
          return;
        }

        if (message.type === MessageType.PONG) {
          const echoTs = message.payload.echoTimestamp as number;
          this.stats.rtt = performance.now() - echoTs;
          return;
        }

        // Dispatch to application handler
        this.config.onMessage(message);
      } catch (err) {
        console.warn('[P2P] Failed to parse message:', err);
      }
    };

    channel.onclose = () => {
      this.connected = false;
      console.log('[P2P] DataChannel CLOSED');
      this.config.onConnectionStateChange('disconnected');
      this.handleDisconnection();
    };

    channel.onerror = (error: any) => {
      console.error('[P2P] DataChannel error:', error);
      this.config.onError(new Error(`DataChannel error: ${error.message}`));
    };
  }

  // -------------------------------------------------------------------------
  // Signaling: SDP and ICE exchange
  // -------------------------------------------------------------------------

  /** Callback set by SignalingBridge to send ICE candidates */
  public onLocalIceCandidate:
    | ((candidate: RTCIceCandidate) => void)
    | null = null;

  /**
   * Create an SDP Offer (Master only).
   */
  async createOffer(): Promise<RTCSessionDescription> {
    if (!this.pc) throw new Error('PeerConnection not initialized');

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await this.pc.setLocalDescription(offer);
    return offer as RTCSessionDescription;
  }

  /**
   * Process a remote SDP Offer and create an Answer (Slave only).
   */
  async handleOffer(
    offer: RTCSessionDescription,
  ): Promise<RTCSessionDescription> {
    if (!this.pc) throw new Error('PeerConnection not initialized');

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer as RTCSessionDescription;
  }

  /**
   * Process a remote SDP Answer (Master only).
   */
  async handleAnswer(answer: RTCSessionDescription): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add a remote ICE candidate received via signaling.
   */
  async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * Send a message to the peer device.
   * Messages are JSON-serialized and sent over the DataChannel.
   */
  send(message: P2PMessage): boolean {
    if (!this.connected || !this.dataChannel) {
      return false;
    }

    try {
      const data = JSON.stringify(message);
      this.dataChannel.send(data);
      this.stats.messagessSent++;
      this.stats.bytessSent += data.length;
      return true;
    } catch (err) {
      console.warn('[P2P] Failed to send message:', err);
      return false;
    }
  }

  /**
   * Send a typed message with auto-populated timestamp.
   */
  sendEvent(type: MessageType, payload: Record<string, unknown> = {}): boolean {
    return this.send({
      type,
      payload,
      sentAt: performance.now(),
    });
  }

  /**
   * Measure RTT with a PING/PONG exchange.
   */
  measureRTT(): void {
    this.sendEvent(MessageType.PING);
  }

  // -------------------------------------------------------------------------
  // Connection Management
  // -------------------------------------------------------------------------

  private handleDisconnection(): void {
    if (this.destroyed) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      // Exponential backoff: 500ms, 1s, 2s, 4s, ...
      const delay = Math.min(
        500 * Math.pow(2, this.reconnectAttempts),
        10000,
      );
      console.log(
        `[P2P] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`,
      );

      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        // Re-initialize will be handled by the calling code
        this.config.onConnectionStateChange('reconnecting');
      }, delay);
    } else {
      this.config.onError(
        new Error('Max reconnection attempts reached'),
      );
    }
  }

  /**
   * Get connection statistics.
   */
  getStats(): ConnectionStats {
    if (this.connected) {
      this.stats.connectionUptime =
        performance.now() - this.connectionStartTime;
    }
    return { ...this.stats };
  }

  /**
   * Check if the DataChannel is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Destroy the connection and clean up all resources.
   */
  destroy(): void {
    this.destroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (e) {
        /* ignore */
      }
      this.dataChannel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch (e) {
        /* ignore */
      }
      this.pc = null;
    }

    this.connected = false;
  }
}
