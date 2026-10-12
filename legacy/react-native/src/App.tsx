/**
 * App.tsx
 *
 * Root component and navigation structure for PickleJudge.
 * Flow: Pairing → Calibration → LiveGame
 */

import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PairingScreen from './screens/PairingScreen';
import CalibrationScreen from './screens/CalibrationScreen';
import LiveGameScreen from './screens/LiveGameScreen';
import SettingsScreen from './screens/SettingsScreen';

// Suppress non-critical warnings during development
LogBox.ignoreLogs([
  'Sending `onPeerFound`',
  'Sending `onPeerLost`',
]);

// ---------------------------------------------------------------------------
// Navigation Types
// ---------------------------------------------------------------------------

export type RootStackParamList = {
  Pairing: undefined;
  Calibration: { role: 'MASTER' | 'SLAVE' };
  LiveGame: { role: 'MASTER' | 'SLAVE' };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ---------------------------------------------------------------------------
// App Component
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <Stack.Navigator
        initialRouteName="Pairing"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#0a0a0a',
          },
          headerTintColor: '#00ff88',
          headerTitleStyle: {
            fontWeight: '700',
            fontSize: 18,
          },
          contentStyle: {
            backgroundColor: '#0a0a0a',
          },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="Pairing"
          component={PairingScreen}
          options={{
            title: 'PickleJudge',
            headerLargeTitle: true,
          }}
        />
        <Stack.Screen
          name="Calibration"
          component={CalibrationScreen}
          options={{
            title: 'Court Calibration',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen
          name="LiveGame"
          component={LiveGameScreen}
          options={{
            title: 'Live Game',
            headerShown: false, // Full-screen camera
            gestureEnabled: false, // Prevent accidental back swipe
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Settings',
            presentation: 'modal',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
