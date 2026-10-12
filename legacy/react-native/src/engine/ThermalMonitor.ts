/**
 * ThermalMonitor.ts
 *
 * Adaptive processing governor that monitors device thermal state and
 * dynamically adjusts the CV pipeline's resource usage to prevent
 * thermal throttling and shutdown during 60-minute outdoor sessions.
 *
 * Thermal states are read from native APIs:
 *   iOS:     ProcessInfo.thermalState (.nominal, .fair, .serious, .critical)
 *   Android: PowerManager.THERMAL_STATUS_* (NONE, LIGHT, MODERATE, SEVERE, etc.)
 *
 * Adaptive strategy:
 *   NOMINAL  → 120 FPS, 1080p, full ML, every frame
 *   FAIR     → 60 FPS, 720p, full ML, every frame
 *   SERIOUS  → 60 FPS, 480p, quantized ML, every 2nd frame
 *   CRITICAL → 30 FPS, 360p, CV-only (no ML), every 3rd frame
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ThermalLevel {
  NOMINAL = 0,
  FAIR = 1,
  SERIOUS = 2,
  CRITICAL = 3,
}

export interface ProcessingProfile {
  targetFPS: number;
  maxResolutionWidth: number;
  maxResolutionHeight: number;
  useMLModel: boolean;
  frameSkip: number; // Process every Nth frame (1 = every frame)
  screenBrightness: number; // 0.0 - 1.0
  enableUIAnimations: boolean;
}

const PROCESSING_PROFILES: Record<ThermalLevel, ProcessingProfile> = {
  [ThermalLevel.NOMINAL]: {
    targetFPS: 120,
    maxResolutionWidth: 1920,
    maxResolutionHeight: 1080,
    useMLModel: true,
    frameSkip: 1,
    screenBrightness: 0.5,
    enableUIAnimations: true,
  },
  [ThermalLevel.FAIR]: {
    targetFPS: 60,
    maxResolutionWidth: 1280,
    maxResolutionHeight: 720,
    useMLModel: true,
    frameSkip: 1,
    screenBrightness: 0.4,
    enableUIAnimations: true,
  },
  [ThermalLevel.SERIOUS]: {
    targetFPS: 60,
    maxResolutionWidth: 854,
    maxResolutionHeight: 480,
    useMLModel: false, // CV-only to reduce compute
    frameSkip: 2,
    screenBrightness: 0.3,
    enableUIAnimations: false,
  },
  [ThermalLevel.CRITICAL]: {
    targetFPS: 30,
    maxResolutionWidth: 640,
    maxResolutionHeight: 360,
    useMLModel: false,
    frameSkip: 3,
    screenBrightness: 0.2,
    enableUIAnimations: false,
  },
};

export interface ThermalState {
  level: ThermalLevel;
  levelName: string;
  profile: ProcessingProfile;
  temperature: number | null; // Device temperature if available (Celsius)
  timestamp: number;
}

export interface ThermalEvent {
  type: 'level_change' | 'warning' | 'auto_pause';
  previousLevel: ThermalLevel;
  currentLevel: ThermalLevel;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// ThermalMonitor
// ---------------------------------------------------------------------------

export class ThermalMonitor {
  private currentLevel: ThermalLevel = ThermalLevel.NOMINAL;
  private currentProfile: ProcessingProfile = PROCESSING_PROFILES[ThermalLevel.NOMINAL];
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private eventLog: ThermalEvent[] = [];
  private nativeEmitter: NativeEventEmitter | null = null;
  private destroyed: boolean = false;

  // Callbacks
  public onThermalChange: ((state: ThermalState) => void) | null = null;
  public onAutoPause: (() => void) | null = null;

  // Frame counter for skip logic
  private frameCounter: number = 0;

  constructor() {}

  /**
   * Start monitoring thermal state.
   * Uses native APIs on both platforms for real-time thermal data.
   */
  start(): void {
    if (Platform.OS === 'ios') {
      this.startIOSMonitoring();
    } else {
      this.startAndroidMonitoring();
    }

    // Fallback polling (in case native events are missed)
    this.pollingInterval = setInterval(() => {
      this.pollThermalState();
    }, 5000);

    console.log('[Thermal] Monitoring started');
  }

  /**
   * iOS: Listen for NSProcessInfo thermal state change notifications.
   */
  private startIOSMonitoring(): void {
    const { ThermalStateModule } = NativeModules;
    if (!ThermalStateModule) {
      console.warn('[Thermal] ThermalStateModule not available on iOS');
      return;
    }

    this.nativeEmitter = new NativeEventEmitter(ThermalStateModule);
    this.nativeEmitter.addListener('thermalStateChanged', (state: { level: number }) => {
      this.handleThermalUpdate(state.level);
    });

    // Get initial state
    ThermalStateModule.getCurrentState().then((state: { level: number }) => {
      this.handleThermalUpdate(state.level);
    });
  }

  /**
   * Android: Register PowerManager thermal status listener.
   */
  private startAndroidMonitoring(): void {
    const { ThermalStateModule } = NativeModules;
    if (!ThermalStateModule) {
      console.warn('[Thermal] ThermalStateModule not available on Android');
      return;
    }

    this.nativeEmitter = new NativeEventEmitter(ThermalStateModule);
    this.nativeEmitter.addListener('thermalStateChanged', (state: { level: number }) => {
      // Map Android thermal levels to our enum
      // Android: 0=NONE, 1=LIGHT, 2=MODERATE, 3=SEVERE, 4=CRITICAL, 5=EMERGENCY, 6=SHUTDOWN
      let mappedLevel: ThermalLevel;
      if (state.level <= 1) {
        mappedLevel = ThermalLevel.NOMINAL;
      } else if (state.level === 2) {
        mappedLevel = ThermalLevel.FAIR;
      } else if (state.level <= 4) {
        mappedLevel = ThermalLevel.SERIOUS;
      } else {
        mappedLevel = ThermalLevel.CRITICAL;
      }
      this.handleThermalUpdate(mappedLevel);
    });

    ThermalStateModule.startMonitoring();
  }

  /**
   * Handle a thermal level update.
   */
  private handleThermalUpdate(level: ThermalLevel): void {
    if (this.destroyed) return;

    const previousLevel = this.currentLevel;

    // Clamp to valid range
    this.currentLevel = Math.min(Math.max(level, 0), 3) as ThermalLevel;
    this.currentProfile = PROCESSING_PROFILES[this.currentLevel];

    if (previousLevel !== this.currentLevel) {
      const event: ThermalEvent = {
        type: 'level_change',
        previousLevel,
        currentLevel: this.currentLevel,
        timestamp: Date.now(),
      };
      this.eventLog.push(event);

      console.log(
        `[Thermal] Level changed: ${ThermalLevel[previousLevel]} → ${ThermalLevel[this.currentLevel]}`,
      );

      this.onThermalChange?.(this.getState());

      // Auto-pause processing at CRITICAL to prevent hardware damage
      if (this.currentLevel === ThermalLevel.CRITICAL) {
        console.warn('[Thermal] CRITICAL thermal state — auto-pausing processing');
        this.onAutoPause?.();
      }
    }
  }

  /**
   * Fallback polling for thermal state.
   */
  private pollThermalState(): void {
    const { ThermalStateModule } = NativeModules;
    if (!ThermalStateModule) return;

    ThermalStateModule.getCurrentState?.()
      .then((state: { level: number }) => {
        this.handleThermalUpdate(state.level);
      })
      .catch(() => {
        /* ignore polling errors */
      });
  }

  // -------------------------------------------------------------------------
  // Frame Processing Decision
  // -------------------------------------------------------------------------

  /**
   * Check if the current frame should be processed based on thermal state.
   * Call this at the top of each frame processor invocation.
   *
   * @returns true if the frame should be processed, false to skip
   */
  shouldProcessFrame(): boolean {
    this.frameCounter++;
    return this.frameCounter % this.currentProfile.frameSkip === 0;
  }

  /**
   * Reset the frame counter (e.g., after config change).
   */
  resetFrameCounter(): void {
    this.frameCounter = 0;
  }

  // -------------------------------------------------------------------------
  // Query State
  // -------------------------------------------------------------------------

  /**
   * Get the current thermal state and recommended processing profile.
   */
  getState(): ThermalState {
    const levelNames: Record<ThermalLevel, string> = {
      [ThermalLevel.NOMINAL]: 'Nominal',
      [ThermalLevel.FAIR]: 'Fair',
      [ThermalLevel.SERIOUS]: 'Serious',
      [ThermalLevel.CRITICAL]: 'Critical',
    };

    return {
      level: this.currentLevel,
      levelName: levelNames[this.currentLevel],
      profile: { ...this.currentProfile },
      temperature: null, // Will be filled by native module if available
      timestamp: Date.now(),
    };
  }

  /**
   * Get the current processing profile.
   */
  getProfile(): ProcessingProfile {
    return { ...this.currentProfile };
  }

  /**
   * Get the thermal event log for diagnostics.
   */
  getEventLog(): ThermalEvent[] {
    return [...this.eventLog];
  }

  /**
   * Check if the device is in a safe thermal state for sustained processing.
   */
  isSafe(): boolean {
    return this.currentLevel <= ThermalLevel.FAIR;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Stop monitoring and clean up.
   */
  destroy(): void {
    this.destroyed = true;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.nativeEmitter) {
      this.nativeEmitter.removeAllListeners('thermalStateChanged');
    }

    const { ThermalStateModule } = NativeModules;
    if (ThermalStateModule?.stopMonitoring) {
      ThermalStateModule.stopMonitoring();
    }

    console.log('[Thermal] Monitoring stopped');
  }
}
