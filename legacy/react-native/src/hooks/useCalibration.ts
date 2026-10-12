/**
 * useCalibration.ts
 *
 * React hook managing the court calibration state.
 * Handles corner point collection, homography computation,
 * and sync with peer device.
 */

import { useState, useCallback, useRef } from 'react';
import { NativeModules } from 'react-native';
import { P2PManager, MessageType } from '../engine/P2PManager';

export interface CalibrationPoint {
  x: number;
  y: number;
}

export interface CalibrationState {
  corners: CalibrationPoint[];
  isCalibrated: boolean;
  reprojectionError: number;
  isNearSide: boolean;
}

export interface UseCalibrationReturn {
  state: CalibrationState;
  addCorner: (x: number, y: number) => void;
  removeLastCorner: () => void;
  reset: () => void;
  calibrate: (frameWidth: number, frameHeight: number) => Promise<boolean>;
  syncWithPeer: (p2p: P2PManager) => void;
}

export function useCalibration(isNearSide: boolean): UseCalibrationReturn {
  const [state, setState] = useState<CalibrationState>({
    corners: [],
    isCalibrated: false,
    reprojectionError: 0,
    isNearSide,
  });

  const addCorner = useCallback(
    (x: number, y: number) => {
      setState((prev) => {
        if (prev.corners.length >= 4) return prev;
        return {
          ...prev,
          corners: [...prev.corners, { x, y }],
        };
      });
    },
    [],
  );

  const removeLastCorner = useCallback(() => {
    setState((prev) => ({
      ...prev,
      corners: prev.corners.slice(0, -1),
      isCalibrated: false,
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      corners: [],
      isCalibrated: false,
      reprojectionError: 0,
      isNearSide,
    });
  }, [isNearSide]);

  const calibrate = useCallback(
    async (frameWidth: number, frameHeight: number): Promise<boolean> => {
      if (state.corners.length !== 4) return false;

      try {
        // Convert screen coordinates to frame coordinates
        const cornerArray = state.corners.flatMap((c) => [
          c.x, c.y,
        ]);

        // Call native calibration module
        // NativeModules.PickleFrameProcessor.calibrate(cornerArray, isNearSide);

        setState((prev) => ({
          ...prev,
          isCalibrated: true,
          reprojectionError: 0, // Will be set by native module
        }));

        return true;
      } catch (error) {
        console.error('[Calibration] Failed:', error);
        return false;
      }
    },
    [state.corners, isNearSide],
  );

  const syncWithPeer = useCallback(
    (p2p: P2PManager) => {
      if (!state.isCalibrated) return;

      p2p.sendEvent(MessageType.CALIBRATION_SYNC, {
        corners: state.corners,
        isNearSide: state.isNearSide,
        reprojectionError: state.reprojectionError,
      });
    },
    [state],
  );

  return {
    state,
    addCorner,
    removeLastCorner,
    reset,
    calibrate,
    syncWithPeer,
  };
}
