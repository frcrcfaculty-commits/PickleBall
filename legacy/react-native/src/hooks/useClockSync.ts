/**
 * useClockSync.ts
 *
 * React hook providing access to the synchronized clock.
 * Wraps ClockSync to provide reactive state updates in components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ClockSync, type ClockSyncState } from '../engine/ClockSync';
import { P2PManager, DeviceRole } from '../engine/P2PManager';

export interface UseClockSyncReturn {
  state: ClockSyncState;
  getSyncedTimestamp: () => number;
  isSynced: boolean;
  accuracy: number;
}

export function useClockSync(
  p2p: P2PManager | null,
  role: DeviceRole,
): UseClockSyncReturn {
  const [state, setState] = useState<ClockSyncState>({
    synced: false,
    offset: 0,
    rtt: 0,
    driftRate: 0,
    accuracy: Infinity,
    roundsCompleted: 0,
  });

  const clockSyncRef = useRef<ClockSync | null>(null);

  useEffect(() => {
    if (!p2p) return;

    const clockSync = new ClockSync(p2p, role);
    clockSyncRef.current = clockSync;

    clockSync.onSyncStateChange = (newState) => {
      setState(newState);
    };

    clockSync.startSync();

    return () => {
      clockSync.destroy();
    };
  }, [p2p, role]);

  const getSyncedTimestamp = useCallback(() => {
    return clockSyncRef.current?.getSyncedTimestamp() ?? performance.now();
  }, []);

  return {
    state,
    getSyncedTimestamp,
    isSynced: state.synced,
    accuracy: state.accuracy,
  };
}
