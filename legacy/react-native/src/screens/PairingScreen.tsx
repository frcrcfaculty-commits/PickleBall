/**
 * PairingScreen.tsx
 *
 * Device discovery and pairing UI. Users select their role (Master/Slave)
 * and the app discovers the peer device on the local network.
 *
 * Flow:
 * 1. User selects role (Master = near side, Slave = far side)
 * 2. Master advertises, Slave browses
 * 3. Devices discover each other via mDNS
 * 4. TCP signaling establishes WebRTC DataChannel
 * 5. Clock synchronization runs
 * 6. Navigate to CalibrationScreen
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

import { P2PManager, DeviceRole, MessageType } from '../engine/P2PManager';
import { ClockSync } from '../engine/ClockSync';
import { SignalingBridge } from '../engine/SignalingBridge';

type Props = NativeStackScreenProps<RootStackParamList, 'Pairing'>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PairingScreen: React.FC<Props> = ({ navigation }) => {
  const [role, setRole] = useState<DeviceRole | null>(null);
  const [status, setStatus] = useState<string>('Select your court position');
  const [isPairing, setIsPairing] = useState(false);
  const [peerFound, setPeerFound] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // Animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Refs for cleanup
  const p2pRef = useRef<P2PManager | null>(null);
  const clockSyncRef = useRef<ClockSync | null>(null);
  const signalingRef = useRef<SignalingBridge | null>(null);

  useEffect(() => {
    // Pulse animation for the scanning indicator
    if (isPairing && !peerFound) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    }
  }, [isPairing, peerFound, pulseAnim]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      signalingRef.current?.destroy();
      clockSyncRef.current?.destroy();
      p2pRef.current?.destroy();
    };
  }, []);

  /**
   * Start the pairing process after role selection.
   */
  const startPairing = useCallback(async (selectedRole: DeviceRole) => {
    setRole(selectedRole);
    setIsPairing(true);
    setStatus(
      selectedRole === DeviceRole.MASTER
        ? 'Advertising... waiting for partner device'
        : 'Scanning for partner device...',
    );

    try {
      // Step 1: Initialize P2P Manager
      const p2p = new P2PManager({
        role: selectedRole,
        onMessage: (message) => {
          // Forward sync messages to ClockSync
          if (
            message.type === MessageType.SYNC_REQ ||
            message.type === MessageType.SYNC_RESP ||
            message.type === MessageType.CLOCK_LOCKED
          ) {
            clockSyncRef.current?.handleMessage(message);
          }
        },
        onConnectionStateChange: (state) => {
          console.log('[Pairing] Connection state:', state);
          if (state === 'connected') {
            setPeerFound(true);
            setStatus('Connected! Synchronizing clocks...');
            startClockSync(p2p, selectedRole);
          }
        },
        onError: (error) => {
          Alert.alert('Connection Error', error.message);
          setIsPairing(false);
        },
      });

      p2pRef.current = p2p;
      await p2p.initialize();

      // Step 2: Initialize Signaling Bridge
      const signaling = new SignalingBridge(p2p, {
        role: selectedRole,
        onPeerDiscovered: (peer) => {
          setStatus(`Found: ${peer.name}. Connecting...`);
        },
        onSignalingComplete: () => {
          setStatus('WebRTC connected! Syncing clocks...');
        },
        onError: (error) => {
          console.error('[Pairing] Signaling error:', error);
        },
      });

      signalingRef.current = signaling;
      await signaling.start();
    } catch (error: any) {
      Alert.alert('Pairing Error', error.message);
      setIsPairing(false);
    }
  }, []);

  /**
   * Run clock synchronization after P2P connection is established.
   */
  const startClockSync = useCallback(
    async (p2p: P2PManager, selectedRole: DeviceRole) => {
      const clockSync = new ClockSync(p2p, selectedRole);
      clockSyncRef.current = clockSync;

      clockSync.onSyncStateChange = (state) => {
        const progress = Math.min(
          state.roundsCompleted / 10,
          1,
        );
        setSyncProgress(progress);

        if (state.synced) {
          setStatus(
            `Clocks synced! Accuracy: ±${state.accuracy.toFixed(1)}ms`,
          );
          setIsReady(true);
        }
      };

      await clockSync.startSync();
    },
    [],
  );

  /**
   * Navigate to calibration after pairing is complete.
   */
  const proceedToCalibration = useCallback(() => {
    if (role) {
      navigation.navigate('Calibration', { role });
    }
  }, [role, navigation]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <View style={styles.container}>
      {/* Title */}
      <View style={styles.header}>
        <Text style={styles.title}>🏓 PickleJudge</Text>
        <Text style={styles.subtitle}>Dual-Camera Line Judge</Text>
      </View>

      {/* Role Selection */}
      {!isPairing && (
        <View style={styles.roleSection}>
          <Text style={styles.sectionTitle}>Select Your Court Position</Text>

          <TouchableOpacity
            style={styles.roleButton}
            onPress={() => startPairing(DeviceRole.MASTER)}
            activeOpacity={0.7}
          >
            <Text style={styles.roleEmoji}>📱 ←</Text>
            <Text style={styles.roleLabel}>Near Side (Master)</Text>
            <Text style={styles.roleDesc}>
              Place this phone on your baseline side
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleButton, styles.roleButtonAlt]}
            onPress={() => startPairing(DeviceRole.SLAVE)}
            activeOpacity={0.7}
          >
            <Text style={styles.roleEmoji}>→ 📱</Text>
            <Text style={styles.roleLabel}>Far Side (Partner)</Text>
            <Text style={styles.roleDesc}>
              Place this phone on the opposite baseline
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Pairing Status */}
      {isPairing && (
        <View style={styles.statusSection}>
          <Animated.View
            style={[
              styles.scanIndicator,
              { transform: [{ scale: pulseAnim }] },
              peerFound && styles.scanIndicatorConnected,
            ]}
          >
            {!peerFound ? (
              <ActivityIndicator size="large" color="#00ff88" />
            ) : (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </Animated.View>

          <Text style={styles.statusText}>{status}</Text>

          {/* Sync progress bar */}
          {peerFound && !isReady && (
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${syncProgress * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {Math.round(syncProgress * 100)}% synced
              </Text>
            </View>
          )}

          {/* Proceed button */}
          {isReady && (
            <TouchableOpacity
              style={styles.proceedButton}
              onPress={proceedToCalibration}
              activeOpacity={0.7}
            >
              <Text style={styles.proceedText}>
                Proceed to Calibration →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Settings gear */}
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('Settings')}
      >
        <Text style={styles.settingsIcon}>⚙️</Text>
      </TouchableOpacity>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 20,
  },
  roleSection: {
    gap: 16,
  },
  roleButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#00ff8833',
    alignItems: 'center',
  },
  roleButtonAlt: {
    borderColor: '#ff880033',
  },
  roleEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  roleLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  roleDesc: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
  statusSection: {
    alignItems: 'center',
    gap: 24,
  },
  scanIndicator: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#00ff8844',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanIndicatorConnected: {
    borderColor: '#00ff88',
    backgroundColor: '#00ff8820',
  },
  checkmark: {
    fontSize: 40,
    color: '#00ff88',
  },
  statusText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    maxWidth: 280,
  },
  progressContainer: {
    width: '80%',
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#222',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00ff88',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
  },
  proceedButton: {
    backgroundColor: '#00ff88',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  proceedText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0a0a0a',
  },
  settingsButton: {
    position: 'absolute',
    top: 60,
    right: 24,
  },
  settingsIcon: {
    fontSize: 24,
  },
});

export default PairingScreen;
