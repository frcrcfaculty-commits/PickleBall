/**
 * SignalingBridge.ts
 *
 * Local TCP-based signaling server for WebRTC session establishment.
 * Replaces cloud signaling servers (Firebase, WebSocket servers, etc.)
 * with a direct TCP connection over the local network.
 *
 * Flow:
 *   1. Master starts a TCP server on port 9876
 *   2. Slave discovers Master's IP via mDNS/NSD (LocalDiscoveryModule)
 *   3. Slave connects to Master's TCP server
 *   4. They exchange SDP offers/answers and ICE candidates as JSON messages
 *   5. Once WebRTC DataChannel opens, signaling is no longer needed
 *   6. TCP server self-destructs to free resources
 *
 * This entire module exists only during the connection setup phase.
 */

import TcpSocket from 'react-native-tcp-socket';
import { P2PManager, DeviceRole } from './P2PManager';
import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalingMessage {
  type: 'sdp-offer' | 'sdp-answer' | 'ice-candidate' | 'discovery-info';
  data: any;
}

export interface SignalingConfig {
  port: number;
  role: DeviceRole;
  serviceType: string;
  onPeerDiscovered: (peerInfo: PeerInfo) => void;
  onSignalingComplete: () => void;
  onError: (error: Error) => void;
}

export interface PeerInfo {
  name: string;
  address: string;
  port: number;
}

const DEFAULT_PORT = 9876;
const SERVICE_TYPE = '_picklejudge._tcp';

// ---------------------------------------------------------------------------
// SignalingBridge
// ---------------------------------------------------------------------------

export class SignalingBridge {
  private config: SignalingConfig;
  private p2p: P2PManager;

  // TCP networking
  private server: any = null; // TCP Server (Master)
  private client: any = null; // TCP Client (Slave)
  private peerSocket: any = null; // Connected peer socket
  private receiveBuffer: string = '';

  // Native discovery module
  private discoveryEmitter: NativeEventEmitter | null = null;
  private destroyed: boolean = false;

  constructor(p2p: P2PManager, config: Partial<SignalingConfig> & { role: DeviceRole }) {
    this.p2p = p2p;
    this.config = {
      port: DEFAULT_PORT,
      serviceType: SERVICE_TYPE,
      onPeerDiscovered: () => {},
      onSignalingComplete: () => {},
      onError: () => {},
      ...config,
    };
  }

  /**
   * Start the signaling process.
   * Master: starts TCP server + advertises via mDNS
   * Slave: browses for peers + connects to Master's TCP server
   */
  async start(): Promise<void> {
    if (this.config.role === DeviceRole.MASTER) {
      await this.startAsServer();
    } else {
      await this.startAsClient();
    }
  }

  // -------------------------------------------------------------------------
  // Master: TCP Server + mDNS Advertising
  // -------------------------------------------------------------------------

  private async startAsServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = TcpSocket.createServer((socket: any) => {
          console.log('[Signaling] Slave connected to signaling server');
          this.peerSocket = socket;
          this.setupSocketHandlers(socket);

          // Now initiate WebRTC: create offer and send it
          this.initiateWebRTC();
        });

        this.server.listen(
          { port: this.config.port, host: '0.0.0.0' },
          () => {
            console.log(`[Signaling] TCP server listening on port ${this.config.port}`);

            // Start mDNS advertising
            this.startAdvertising();
            resolve();
          },
        );

        this.server.on('error', (err: Error) => {
          console.error('[Signaling] Server error:', err);
          this.config.onError(err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Advertise this device via platform-specific local discovery.
   */
  private startAdvertising(): void {
    const { LocalDiscovery } = NativeModules;

    if (!LocalDiscovery) {
      console.warn('[Signaling] LocalDiscovery native module not found');
      return;
    }

    // Start advertising
    LocalDiscovery.startAdvertising(
      this.config.serviceType,
      this.config.port,
      'PickleJudge-Master',
    );

    console.log('[Signaling] Started advertising via mDNS');
  }

  // -------------------------------------------------------------------------
  // Slave: mDNS Discovery + TCP Client
  // -------------------------------------------------------------------------

  private async startAsClient(): Promise<void> {
    console.log('[Signaling] Starting peer discovery...');

    const { LocalDiscovery } = NativeModules;

    if (!LocalDiscovery) {
      throw new Error('LocalDiscovery native module not available');
    }

    // Set up discovery event listener
    this.discoveryEmitter = new NativeEventEmitter(LocalDiscovery);

    this.discoveryEmitter.addListener('onPeerFound', (peer: PeerInfo) => {
      console.log(`[Signaling] Found peer: ${peer.name} at ${peer.address}:${peer.port}`);
      this.config.onPeerDiscovered(peer);

      // Connect to the discovered Master
      this.connectToMaster(peer.address, peer.port);
    });

    this.discoveryEmitter.addListener('onPeerLost', (peer: { name: string }) => {
      console.log(`[Signaling] Lost peer: ${peer.name}`);
    });

    // Start browsing
    LocalDiscovery.startBrowsing(this.config.serviceType);
  }

  /**
   * Connect to the Master's TCP signaling server.
   */
  private connectToMaster(address: string, port: number): void {
    if (this.client) return; // Already connecting

    this.client = TcpSocket.createConnection(
      { port, host: address },
      () => {
        console.log(`[Signaling] Connected to Master at ${address}:${port}`);
        this.peerSocket = this.client;
        this.setupSocketHandlers(this.client);
      },
    );

    this.client.on('error', (err: Error) => {
      console.error('[Signaling] Client connection error:', err);
      this.config.onError(err);
    });
  }

  // -------------------------------------------------------------------------
  // Shared: Socket message handling
  // -------------------------------------------------------------------------

  private setupSocketHandlers(socket: any): void {
    socket.on('data', (data: Buffer) => {
      // TCP is stream-based; messages may be fragmented or concatenated
      this.receiveBuffer += data.toString('utf-8');

      // Messages are delimited by newlines
      let newlineIdx: number;
      while ((newlineIdx = this.receiveBuffer.indexOf('\n')) !== -1) {
        const raw = this.receiveBuffer.substring(0, newlineIdx);
        this.receiveBuffer = this.receiveBuffer.substring(newlineIdx + 1);

        try {
          const message: SignalingMessage = JSON.parse(raw);
          this.handleSignalingMessage(message);
        } catch (err) {
          console.warn('[Signaling] Failed to parse message:', raw);
        }
      }
    });

    socket.on('close', () => {
      console.log('[Signaling] Peer socket closed');
    });

    socket.on('error', (err: Error) => {
      console.error('[Signaling] Socket error:', err);
    });
  }

  /**
   * Send a signaling message to the peer over TCP.
   */
  private sendSignalingMessage(message: SignalingMessage): void {
    if (!this.peerSocket) {
      console.warn('[Signaling] No peer socket available');
      return;
    }

    const json = JSON.stringify(message) + '\n';
    this.peerSocket.write(json);
  }

  /**
   * Handle an incoming signaling message.
   */
  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    switch (message.type) {
      case 'sdp-offer':
        // Slave receives offer → create answer
        console.log('[Signaling] Received SDP offer');
        const answer = await this.p2p.handleOffer(message.data);
        this.sendSignalingMessage({
          type: 'sdp-answer',
          data: answer,
        });
        break;

      case 'sdp-answer':
        // Master receives answer
        console.log('[Signaling] Received SDP answer');
        await this.p2p.handleAnswer(message.data);
        break;

      case 'ice-candidate':
        // Both sides process remote ICE candidates
        console.log('[Signaling] Received ICE candidate');
        await this.p2p.addIceCandidate(message.data);
        break;
    }
  }

  /**
   * Master initiates WebRTC negotiation after TCP connection is established.
   */
  private async initiateWebRTC(): Promise<void> {
    // Set up ICE candidate forwarding
    this.p2p.onLocalIceCandidate = (candidate) => {
      this.sendSignalingMessage({
        type: 'ice-candidate',
        data: candidate,
      });
    };

    // Create and send SDP offer
    const offer = await this.p2p.createOffer();
    this.sendSignalingMessage({
      type: 'sdp-offer',
      data: offer,
    });

    console.log('[Signaling] Sent SDP offer to Slave');
  }

  /**
   * Called when WebRTC DataChannel opens — signaling is no longer needed.
   */
  onDataChannelOpen(): void {
    console.log('[Signaling] DataChannel open — shutting down signaling');
    this.destroy();
    this.config.onSignalingComplete();
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Destroy all signaling resources.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const { LocalDiscovery } = NativeModules;

    // Stop mDNS advertising/browsing
    if (LocalDiscovery) {
      try {
        LocalDiscovery.stopAdvertising();
        LocalDiscovery.stopBrowsing();
      } catch (e) {
        /* ignore */
      }
    }

    // Remove event listeners
    if (this.discoveryEmitter) {
      this.discoveryEmitter.removeAllListeners('onPeerFound');
      this.discoveryEmitter.removeAllListeners('onPeerLost');
    }

    // Close TCP connections
    if (this.peerSocket) {
      try {
        this.peerSocket.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    if (this.server) {
      try {
        this.server.close();
      } catch (e) {
        /* ignore */
      }
    }
    if (this.client) {
      try {
        this.client.destroy();
      } catch (e) {
        /* ignore */
      }
    }

    console.log('[Signaling] Signaling bridge destroyed');
  }
}
