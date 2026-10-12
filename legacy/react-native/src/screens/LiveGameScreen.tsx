/**
 * LiveGameScreen.tsx
 *
 * The main game screen with full-screen camera running at 120 FPS.
 * Displays real-time ball tracking overlay, bounce markers, and
 * IN/OUT call results.
 *
 * This screen:
 * 1. Runs the camera at maximum FPS with fast shutter speed
 * 2. Invokes the C++ Frame Processor on every frame
 * 3. Draws real-time ball position indicator
 * 4. Shows bounce markers on the court
 * 5. Displays large IN/OUT call overlays
 * 6. Shows thermal state, FPS counter, and sync status in HUD
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

import { ThermalMonitor, ThermalLevel } from '../engine/ThermalMonitor';
import { CallResult } from '../engine/DecisionEngine';

type Props = NativeStackScreenProps<RootStackParamList, 'LiveGame'>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LiveGameScreen: React.FC<Props> = ({ navigation, route }) => {
  const { role } = route.params;
  const device = useCameraDevice('back');

  // Camera format: target 120 FPS at 720p for balance of quality and perf
  const format = useCameraFormat(device, [
    { fps: 120 },
    { videoResolution: { width: 1280, height: 720 } },
  ]);

  // State
  const [ballPosition, setBallPosition] = useState<{
    x: number;
    y: number;
    radius: number;
  } | null>(null);
  const [lastCall, setLastCall] = useState<{
    result: CallResult;
    timestamp: number;
  } | null>(null);
  const [fps, setFps] = useState(0);
  const [thermalLevel, setThermalLevel] = useState(ThermalLevel.NOMINAL);
  const [isTracking, setIsTracking] = useState(false);
  const [bounceMarkers, setBounceMarkers] = useState<
    Array<{ x: number; y: number; result: CallResult; id: number }>
  >([]);

  // Animation for call overlay
  const callOpacity = useRef(new Animated.Value(0)).current;
  const callScale = useRef(new Animated.Value(0.5)).current;

  // FPS counter
  const frameCount = useRef(0);
  const lastFpsUpdate = useRef(Date.now());

  // Thermal monitor
  const thermalMonitor = useRef(new ThermalMonitor()).current;

  // Bounce marker ID counter
  const bounceIdCounter = useRef(0);

  useEffect(() => {
    // Start thermal monitoring
    thermalMonitor.onThermalChange = (state) => {
      setThermalLevel(state.level);
    };
    thermalMonitor.start();

    // FPS counter update interval
    const fpsTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFpsUpdate.current) / 1000;
      if (elapsed > 0) {
        setFps(Math.round(frameCount.current / elapsed));
        frameCount.current = 0;
        lastFpsUpdate.current = now;
      }
    }, 1000);

    return () => {
      thermalMonitor.destroy();
      clearInterval(fpsTimer);
    };
  }, [thermalMonitor]);

  /**
   * Callback from frame processor to update UI with detection results.
   * Runs on the JS thread via useRunOnJS.
   */
  const onFrameResult = useRunOnJS(
    useCallback(
      (result: any) => {
        frameCount.current++;

        if (result.ballFound) {
          // Scale pixel coordinates from camera resolution to screen
          const scaleX = SCREEN_WIDTH / (format?.videoWidth ?? 1280);
          const scaleY = SCREEN_HEIGHT / (format?.videoHeight ?? 720);

          setBallPosition({
            x: result.pixelX * scaleX,
            y: result.pixelY * scaleY,
            radius: Math.max(result.radius * scaleX, 8),
          });
          setIsTracking(true);
        } else {
          setIsTracking(false);
        }

        // Handle bounce detection
        if (result.isBounce) {
          const bounceId = bounceIdCounter.current++;
          const callResult =
            result.bounceConfidence < 0.5
              ? CallResult.UNCERTAIN
              : result.bounceCourtX < 0 ||
                  result.bounceCourtX > 240 ||
                  result.bounceCourtY < 0 ||
                  result.bounceCourtY > 528
                ? CallResult.OUT
                : CallResult.IN;

          // Add bounce marker
          const scaleX = SCREEN_WIDTH / (format?.videoWidth ?? 1280);
          const scaleY = SCREEN_HEIGHT / (format?.videoHeight ?? 720);
          setBounceMarkers((prev) => [
            ...prev.slice(-5), // Keep last 5 markers
            {
              x: result.pixelX * scaleX,
              y: result.pixelY * scaleY,
              result: callResult,
              id: bounceId,
            },
          ]);

          // Show call overlay
          if (callResult !== CallResult.UNCERTAIN) {
            showCallOverlay(callResult);
          }
        }
      },
      [format],
    ),
    [],
  );

  /**
   * VisionCamera Frame Processor.
   * Runs on the native thread at camera FPS.
   * Calls into the C++ PickleJudge pipeline via JSI.
   */
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // Check thermal throttling (skip frames if needed)
      // Note: thermal check would be done via shared value in production

      // Call the C++ pipeline
      // In production, this calls the registered processPickleFrame plugin
      // const result = processPickleFrame(frame, { timestamp: syncedTimestamp });

      // For now, simulate the frame processor call structure
      const result = {
        ballFound: false,
        pixelX: 0,
        pixelY: 0,
        courtX: 0,
        courtY: 0,
        radius: 0,
        confidence: 0,
        isBounce: false,
        bounceCourtX: 0,
        bounceCourtY: 0,
        bounceTimestamp: 0,
        bounceConfidence: 0,
        trackingState: 0,
      };

      // Send result to JS thread
      onFrameResult(result);
    },
    [onFrameResult],
  );

  /**
   * Show a large IN/OUT call overlay with animation.
   */
  const showCallOverlay = useCallback(
    (result: CallResult) => {
      setLastCall({ result, timestamp: Date.now() });

      // Animate: scale up and fade in, then fade out
      callOpacity.setValue(1);
      callScale.setValue(0.5);

      Animated.parallel([
        Animated.spring(callScale, {
          toValue: 1,
          friction: 5,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(1500),
          Animated.timing(callOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    },
    [callOpacity, callScale],
  );

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera not available</Text>
      </View>
    );
  }

  const thermalColors: Record<ThermalLevel, string> = {
    [ThermalLevel.NOMINAL]: '#00ff88',
    [ThermalLevel.FAIR]: '#ffcc00',
    [ThermalLevel.SERIOUS]: '#ff8800',
    [ThermalLevel.CRITICAL]: '#ff0044',
  };

  return (
    <View style={styles.container}>
      {/* Full-screen camera at max FPS */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        fps={120}
        exposure={-2} // Fast shutter to reduce motion blur
        enableBufferCompression={false}
        pixelFormat="yuv"
        frameProcessor={frameProcessor}
      />

      {/* Ball tracking overlay */}
      <Svg
        style={StyleSheet.absoluteFill}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        pointerEvents="none"
      >
        {/* Ball position indicator */}
        {ballPosition && isTracking && (
          <>
            <Circle
              cx={ballPosition.x}
              cy={ballPosition.y}
              r={ballPosition.radius + 4}
              fill="none"
              stroke="#00ff88"
              strokeWidth={2}
              opacity={0.8}
            />
            <Circle
              cx={ballPosition.x}
              cy={ballPosition.y}
              r={3}
              fill="#00ff88"
            />
          </>
        )}

        {/* Bounce markers */}
        {bounceMarkers.map((marker) => (
          <React.Fragment key={marker.id}>
            <Circle
              cx={marker.x}
              cy={marker.y}
              r={16}
              fill={marker.result === CallResult.OUT ? '#ff004466' : '#00ff8866'}
              stroke={marker.result === CallResult.OUT ? '#ff0044' : '#00ff88'}
              strokeWidth={2}
            />
            <SvgText
              x={marker.x}
              y={marker.y + 5}
              textAnchor="middle"
              fill="#fff"
              fontSize={12}
              fontWeight="bold"
            >
              {marker.result === CallResult.OUT ? '✕' : '✓'}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>

      {/* Call result overlay (large animated text) */}
      {lastCall && (
        <Animated.View
          style={[
            styles.callOverlay,
            {
              opacity: callOpacity,
              transform: [{ scale: callScale }],
            },
          ]}
          pointerEvents="none"
        >
          <Text
            style={[
              styles.callText,
              {
                color:
                  lastCall.result === CallResult.OUT
                    ? '#ff0044'
                    : '#00ff88',
              },
            ]}
          >
            {lastCall.result === CallResult.OUT ? 'OUT!' : 'IN'}
          </Text>
        </Animated.View>
      )}

      {/* HUD: Top bar */}
      <View style={styles.hud}>
        <View style={styles.hudRow}>
          {/* FPS counter */}
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>FPS</Text>
            <Text style={styles.hudValue}>{fps}</Text>
          </View>

          {/* Tracking status */}
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>TRACK</Text>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isTracking ? '#00ff88' : '#ff0044',
                },
              ]}
            />
          </View>

          {/* Thermal state */}
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>TEMP</Text>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: thermalColors[thermalLevel],
                },
              ]}
            />
          </View>

          {/* Role indicator */}
          <View style={styles.hudItem}>
            <Text style={styles.hudLabel}>{role}</Text>
          </View>
        </View>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.endButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.endButtonText}>End Session</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  callOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callText: {
    fontSize: 120,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 20,
  },
  hud: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  hudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  hudItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  hudLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hudValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  endButton: {
    backgroundColor: 'rgba(255,0,68,0.3)',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,0,68,0.5)',
  },
  endButtonText: {
    color: '#ff4466',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 100,
  },
});

export default LiveGameScreen;
