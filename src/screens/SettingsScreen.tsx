/**
 * SettingsScreen.tsx
 *
 * Configuration screen for adjusting PickleJudge parameters.
 * Presented as a modal from the PairingScreen.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const [courtMode, setCourtMode] = useState<'doubles' | 'singles'>('doubles');
  const [enableSound, setEnableSound] = useState(true);
  const [enableHaptics, setEnableHaptics] = useState(true);
  const [enableKitchenFault, setEnableKitchenFault] = useState(false);
  const [ballColor, setBallColor] = useState<'outdoor' | 'indoor_orange' | 'indoor_white'>('outdoor');
  const [targetFPS, setTargetFPS] = useState<60 | 120>(120);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Court Mode */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Court Mode</Text>
        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[
              styles.segment,
              courtMode === 'doubles' && styles.segmentActive,
            ]}
            onPress={() => setCourtMode('doubles')}
          >
            <Text
              style={[
                styles.segmentText,
                courtMode === 'doubles' && styles.segmentTextActive,
              ]}
            >
              Doubles
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segment,
              courtMode === 'singles' && styles.segmentActive,
            ]}
            onPress={() => setCourtMode('singles')}
          >
            <Text
              style={[
                styles.segmentText,
                courtMode === 'singles' && styles.segmentTextActive,
              ]}
            >
              Singles
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Ball Color */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ball Color Profile</Text>
        {[
          { key: 'outdoor' as const, label: 'Outdoor (Neon Yellow/Green)', emoji: '🟡' },
          { key: 'indoor_orange' as const, label: 'Indoor (Orange)', emoji: '🟠' },
          { key: 'indoor_white' as const, label: 'Indoor (White)', emoji: '⚪' },
        ].map((option) => (
          <TouchableOpacity
            key={option.key}
            style={[
              styles.radioRow,
              ballColor === option.key && styles.radioRowActive,
            ]}
            onPress={() => setBallColor(option.key)}
          >
            <Text style={styles.radioEmoji}>{option.emoji}</Text>
            <Text style={styles.radioLabel}>{option.label}</Text>
            <View
              style={[
                styles.radioCircle,
                ballColor === option.key && styles.radioCircleActive,
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Camera FPS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Target Frame Rate</Text>
        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[
              styles.segment,
              targetFPS === 60 && styles.segmentActive,
            ]}
            onPress={() => setTargetFPS(60)}
          >
            <Text
              style={[
                styles.segmentText,
                targetFPS === 60 && styles.segmentTextActive,
              ]}
            >
              60 FPS
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segment,
              targetFPS === 120 && styles.segmentActive,
            ]}
            onPress={() => setTargetFPS(120)}
          >
            <Text
              style={[
                styles.segmentText,
                targetFPS === 120 && styles.segmentTextActive,
              ]}
            >
              120 FPS
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          120 FPS provides more accurate tracking but uses more battery.
        </Text>
      </View>

      {/* Toggles */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alerts</Text>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Sound Alerts</Text>
          <Switch
            value={enableSound}
            onValueChange={setEnableSound}
            trackColor={{ false: '#333', true: '#00ff88' }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Haptic Feedback</Text>
          <Switch
            value={enableHaptics}
            onValueChange={setEnableHaptics}
            trackColor={{ false: '#333', true: '#00ff88' }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Kitchen Fault Detection</Text>
          <Switch
            value={enableKitchenFault}
            onValueChange={setEnableKitchenFault}
            trackColor={{ false: '#333', true: '#00ff88' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Version info */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>PickleJudge v1.0.0</Text>
        <Text style={styles.footerText}>Dual-Camera Line Judge System</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#00ff88',
  },
  segmentText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 14,
  },
  segmentTextActive: {
    color: '#0a0a0a',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  radioRowActive: {
    borderColor: '#00ff88',
  },
  radioEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  radioLabel: {
    flex: 1,
    color: '#ccc',
    fontSize: 14,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#444',
  },
  radioCircleActive: {
    borderColor: '#00ff88',
    backgroundColor: '#00ff88',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  toggleLabel: {
    color: '#ccc',
    fontSize: 14,
  },
  hint: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  footer: {
    alignItems: 'center',
    marginTop: 20,
    gap: 4,
  },
  footerText: {
    color: '#444',
    fontSize: 12,
  },
});

export default SettingsScreen;
