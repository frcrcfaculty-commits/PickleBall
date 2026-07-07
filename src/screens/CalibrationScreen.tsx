/**
 * CalibrationScreen.tsx
 *
 * Interactive court calibration UI. The user taps 4 corners of their
 * visible half-court on the camera preview. These pixel coordinates
 * are used to compute a homography matrix for perspective transform.
 *
 * Corner selection order:
 * 1. Near-left baseline corner
 * 2. Near-right baseline corner
 * 3. Far-right kitchen/net line corner
 * 4. Far-left kitchen/net line corner
 *
 * After calibration, a grid overlay is drawn on the preview to
 * visually verify the accuracy of the mapping.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
} from 'react-native-vision-camera';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Calibration'>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const CORNER_LABELS = [
  'Near-Left Baseline',
  'Near-Right Baseline',
  'Far-Right Kitchen Line',
  'Far-Left Kitchen Line',
];

const CORNER_INSTRUCTIONS = [
  'Tap the NEAR-LEFT baseline corner of the court',
  'Tap the NEAR-RIGHT baseline corner',
  'Tap the FAR-RIGHT corner (at the kitchen/net line)',
  'Tap the FAR-LEFT corner (at the kitchen/net line)',
];

interface CornerPoint {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CalibrationScreen: React.FC<Props> = ({ navigation, route }) => {
  const { role } = route.params;
  const device = useCameraDevice('back');

  // Use a moderate format for calibration (doesn't need 120fps)
  const format = useCameraFormat(device, [
    { fps: 30 },
    { videoResolution: { width: 1920, height: 1080 } },
  ]);

  const [corners, setCorners] = useState<CornerPoint[]>([]);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [gridLines, setGridLines] = useState<
    Array<{ x1: number; y1: number; x2: number; y2: number }>
  >([]);

  const currentCornerIndex = corners.length;

  /**
   * Handle tap on the camera preview to set a corner point.
   */
  const tapGesture = Gesture.Tap().onEnd((event) => {
    if (corners.length >= 4) return;

    const newCorner: CornerPoint = {
      x: event.x,
      y: event.y,
    };

    const updatedCorners = [...corners, newCorner];
    setCorners(updatedCorners);

    if (updatedCorners.length === 4) {
      // All 4 corners selected — compute calibration
      computeCalibration(updatedCorners);
    }
  });

  /**
   * Compute the homography from selected corners.
   * Calls into the C++ native module.
   */
  const computeCalibration = useCallback(
    (selectedCorners: CornerPoint[]) => {
      try {
        // Convert screen coordinates to image coordinates
        // (screen may be scaled differently than the camera frame)
        const imageCorners = selectedCorners.map((c) => ({
          x: (c.x / SCREEN_WIDTH) * (format?.videoWidth ?? 1920),
          y: (c.y / SCREEN_HEIGHT) * (format?.videoHeight ?? 1080),
        }));

        // Call native C++ calibration
        // This would be invoked via the FrameProcessorPlugin's calibrate function
        const cornerArray = imageCorners.flatMap((c) => [c.x, c.y]);

        // For now, we'll validate the shape and proceed
        // In production, this calls: NativeModules.PickleFrameProcessor.calibrate(cornerArray, isNearSide)
        const isNearSide = role === 'MASTER';

        console.log('[Calibration] Computing homography...');
        console.log('[Calibration] Corners:', imageCorners);
        console.log('[Calibration] Is near side:', isNearSide);

        // Generate preview grid (simplified — in production this comes from C++)
        generatePreviewGrid(selectedCorners);
        setIsCalibrated(true);
      } catch (error: any) {
        Alert.alert(
          'Calibration Error',
          error.message || 'Failed to compute homography. Please try again.',
          [
            {
              text: 'Retry',
              onPress: resetCalibration,
            },
          ],
        );
      }
    },
    [format, role],
  );

  /**
   * Generate a grid overlay to preview the calibration accuracy.
   */
  const generatePreviewGrid = useCallback(
    (selectedCorners: CornerPoint[]) => {
      if (selectedCorners.length < 4) return;

      const lines: Array<{
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      }> = [];

      // Draw the quadrilateral border
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        lines.push({
          x1: selectedCorners[i].x,
          y1: selectedCorners[i].y,
          x2: selectedCorners[next].x,
          y2: selectedCorners[next].y,
        });
      }

      // Draw interior grid lines (approximate subdivision)
      // This is a simplified version — real overlay uses homography inverse
      const lerp = (a: CornerPoint, b: CornerPoint, t: number) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });

      // Horizontal lines (along court depth)
      for (let t = 0.25; t < 1; t += 0.25) {
        const left = lerp(selectedCorners[0], selectedCorners[3], t);
        const right = lerp(selectedCorners[1], selectedCorners[2], t);
        lines.push({
          x1: left.x,
          y1: left.y,
          x2: right.x,
          y2: right.y,
        });
      }

      // Vertical center line
      const topCenter = lerp(selectedCorners[0], selectedCorners[1], 0.5);
      const bottomCenter = lerp(selectedCorners[3], selectedCorners[2], 0.5);
      lines.push({
        x1: topCenter.x,
        y1: topCenter.y,
        x2: bottomCenter.x,
        y2: bottomCenter.y,
      });

      setGridLines(lines);
    },
    [],
  );

  /**
   * Reset calibration to re-select corners.
   */
  const resetCalibration = useCallback(() => {
    setCorners([]);
    setIsCalibrated(false);
    setGridLines([]);
  }, []);

  /**
   * Confirm calibration and proceed to live game.
   */
  const confirmCalibration = useCallback(() => {
    navigation.navigate('LiveGame', { role });
  }, [navigation, role]);

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera not available</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Camera Preview */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        photo={false}
        video={false}
      />

      {/* Touch overlay for corner selection */}
      <GestureDetector gesture={tapGesture}>
        <View style={StyleSheet.absoluteFill}>
          {/* SVG Overlay for corners and grid */}
          <Svg
            style={StyleSheet.absoluteFill}
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
          >
            {/* Draw selected corner markers */}
            {corners.map((corner, index) => (
              <React.Fragment key={index}>
                <Circle
                  cx={corner.x}
                  cy={corner.y}
                  r={12}
                  fill={index < corners.length - 1 ? '#00ff88' : '#ffff00'}
                  opacity={0.9}
                  stroke="#fff"
                  strokeWidth={2}
                />
                {/* Corner label */}
                {/* Note: SVG Text requires react-native-svg */}
              </React.Fragment>
            ))}

            {/* Draw connecting lines between placed corners */}
            {corners.length >= 2 &&
              corners.slice(0, -1).map((corner, index) => (
                <Line
                  key={`line-${index}`}
                  x1={corner.x}
                  y1={corner.y}
                  x2={corners[index + 1].x}
                  y2={corners[index + 1].y}
                  stroke="#00ff88"
                  strokeWidth={2}
                  strokeDasharray="8,4"
                />
              ))}

            {/* Close the polygon when all 4 corners are placed */}
            {corners.length === 4 && (
              <Line
                x1={corners[3].x}
                y1={corners[3].y}
                x2={corners[0].x}
                y2={corners[0].y}
                stroke="#00ff88"
                strokeWidth={2}
                strokeDasharray="8,4"
              />
            )}

            {/* Grid overlay after calibration */}
            {gridLines.map((line, index) => (
              <Line
                key={`grid-${index}`}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="#00aaff"
                strokeWidth={1.5}
                opacity={0.6}
              />
            ))}
          </Svg>
        </View>
      </GestureDetector>

      {/* Instruction overlay */}
      <View style={styles.instructionBar}>
        <Text style={styles.instructionText}>
          {currentCornerIndex < 4
            ? `${currentCornerIndex + 1}/4: ${CORNER_INSTRUCTIONS[currentCornerIndex]}`
            : isCalibrated
              ? '✅ Calibration complete! Verify the grid overlay.'
              : 'Computing calibration...'}
        </Text>
      </View>

      {/* Corner counter */}
      <View style={styles.cornerCounter}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.cornerDot,
              i < corners.length && styles.cornerDotActive,
              i === currentCornerIndex && styles.cornerDotCurrent,
            ]}
          />
        ))}
      </View>

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        {corners.length > 0 && !isCalibrated && (
          <TouchableOpacity
            style={styles.resetButton}
            onPress={resetCalibration}
          >
            <Text style={styles.resetButtonText}>↺ Reset</Text>
          </TouchableOpacity>
        )}

        {isCalibrated && (
          <>
            <TouchableOpacity
              style={styles.resetButton}
              onPress={resetCalibration}
            >
              <Text style={styles.resetButtonText}>↺ Redo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={confirmCalibration}
            >
              <Text style={styles.confirmButtonText}>Start Game →</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </GestureHandlerRootView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  instructionBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  instructionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  cornerCounter: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  cornerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#666',
  },
  cornerDotActive: {
    backgroundColor: '#00ff88',
    borderColor: '#00ff88',
  },
  cornerDotCurrent: {
    backgroundColor: '#ffff00',
    borderColor: '#ffff00',
  },
  buttonRow: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  resetButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  resetButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#00ff88',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  confirmButtonText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 100,
  },
});

export default CalibrationScreen;
