/**
 * useP2P.ts
 *
 * React hook that manages the full P2P lifecycle:
 * discovery → signaling → WebRTC connection → clock sync.
 *
 * Provides a clean API for screens to access P2P state and send messages.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { P2PManager, DeviceRole, MessageType, type P2PMessage } from '../engine/P2PManager';
import { ClockSync, type ClockSyncState } from '../engine/ClockSync';
import { SignalingBridge } from '../engine/SignalingBridge';

export interface P2PState {
  isConnected: boolean;
  isDiscovering: boolean;
  isSynced: boolean;
  peerName: string | null;
  syncState: ClockSyncState | null;
  rtt: number;
  error: Error | null;
}

export interface UseP2PReturn {
  state: P2PState;
  connect: (role: DeviceRole) => Promise<void>;
  disconnect: () => void;
  sendEvent: (type: MessageType, payload?: Record<string, unknown>) => boolean;
  getSyncedTimestamp: () => number;
  onMessage: (handler: (message: P2PMessage) => void) => void;
}

export function useP2P(): UseP2PReturn {
  const [state, setState] = useState<P2PState>({
    isConnected: false,
    isDiscovering: false,
    isSynced: false,
    peerName: null,
    syncState: null,
    rtt: 0,
    error: null,
  });

  const p2pRef = useRef<P2PManager | null>(null);
  const clockSyncRef = useRef<ClockSync | null>(null);
  const signalingRef = useRef<SignalingBridge | null>(null);
  const messageHandlerRef = useRef<((message: P2PMessage) => void) | null>(null);

  const connect = useCallback(async (role: DeviceRole) => {
    setState((prev) => ({ ...prev, isDiscovering: true, error: null }));

    try {
      const p2p = new P2PManager({
        role,
        onMessage: (message) => {
          // Forward to clock sync
          if (
            message.type === MessageType.SYNC_REQ ||
            message.type === MessageType.SYNC_RESP ||
            message.type === MessageType.CLOCK_LOCKED
          ) {
            clockSyncRef.current?.handleMessage(message);
          }

          // Forward to application handler
          messageHandlerRef.current?.(message);
        },
        onConnectionStateChange: (connectionState) => {
          setState((prev) => ({
            ...prev,
            isConnected: connectionState === 'connected',
          }));

          if (connectionState === 'connected') {
            // Start clock sync
            const clockSync = new ClockSync(p2p, role);
            clockSyncRef.current = clockSync;

            clockSync.onSyncStateChange = (syncState) => {
              setState((prev) => ({
                ...prev,
                isSynced: syncState.synced,
                syncState,
                rtt: syncState.rtt,
              }));
            };

            clockSync.startSync();
          }
        },
        onError: (error) => {
          setState((prev) => ({ ...prev, error }));
        },
      });

      p2pRef.current = p2p;
      await p2p.initialize();

      const signaling = new SignalingBridge(p2p, {
        role,
        onPeerDiscovered: (peer) => {
          setState((prev) => ({
            ...prev,
            peerName: peer.name,
          }));
        },
        onSignalingComplete: () => {
          signalingRef.current?.destroy();
        },
        onError: (error) => {
          setState((prev) => ({ ...prev, error }));
        },
      });

      signalingRef.current = signaling;
      await signaling.start();
    } catch (error: any) {
      setState((prev) => ({ ...prev, error, isDiscovering: false }));
    }
  }, []);

  const disconnect = useCallback(() => {
    signalingRef.current?.destroy();
    clockSyncRef.current?.destroy();
    p2pRef.current?.destroy();

    setState({
      isConnected: false,
      isDiscovering: false,
      isSynced: false,
      peerName: null,
      syncState: null,
      rtt: 0,
      error: null,
    });
  }, []);

  const sendEvent = useCallback(
    (type: MessageType, payload: Record<string, unknown> = {}) => {
      return p2pRef.current?.sendEvent(type, payload) ?? false;
    },
    [],
  );

  const getSyncedTimestamp = useCallback(() => {
    return clockSyncRef.current?.getSyncedTimestamp() ?? performance.now();
  }, []);

  const onMessage = useCallback((handler: (message: P2PMessage) => void) => {
    messageHandlerRef.current = handler;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    sendEvent,
    getSyncedTimestamp,
    onMessage,
  };
}
