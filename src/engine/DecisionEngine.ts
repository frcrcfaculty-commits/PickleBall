/**
 * DecisionEngine.ts
 *
 * The core in/out determination logic. When a bounce is detected by the C++
 * pipeline, this engine:
 *
 * 1. Converts the bounce coordinate to court-space (already done by pipeline)
 * 2. Checks if the bounce point falls within the legal boundary polygon
 * 3. Applies ball-radius compensation (ball is IN if any part touches the line)
 * 4. Applies line-width compensation (outer edge of line is the boundary)
 * 5. Broadcasts the decision to the peer device
 * 6. Triggers audio/haptic alerts on both devices
 *
 * Court coordinate system (inches, origin at near-left baseline corner):
 *   X: 0 (left sideline) → 240 (right sideline)
 *   Y: 0 (near baseline) → 264 (net/kitchen line for half-court)
 *       or 0 → 528 for full court
 */

import { P2PManager, MessageType } from './P2PManager';
import { AudioManager } from '../utils/audioManager';
import { COURT } from '../utils/courtDimensions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BounceEvent {
  courtX: number; // Court-space X (inches)
  courtY: number; // Court-space Y (inches)
  timestamp: number; // Synced timestamp (ms)
  confidence: number; // Detection confidence (0.0 - 1.0)
  source: 'local' | 'remote'; // Which device detected the bounce
}

export enum CallResult {
  IN = 'IN',
  OUT = 'OUT',
  KITCHEN_FAULT = 'KITCHEN_FAULT', // Ball bounced in kitchen during a volley
  UNCERTAIN = 'UNCERTAIN', // Low confidence — don't call
}

export interface LineCallDecision {
  result: CallResult;
  bounceEvent: BounceEvent;
  distanceFromLine: number; // Distance in inches from nearest boundary (negative = outside)
  nearestLine: string; // Which line is closest: 'baseline', 'sideline_left', etc.
  compensatedResult: CallResult; // Result after ball-radius compensation
}

export interface DecisionEngineConfig {
  ballRadius: number; // Ball radius in inches (1.437 for outdoor)
  lineWidth: number; // Line width in inches (2.0 official)
  uncertaintyThreshold: number; // Min confidence to make a call
  courtMode: 'singles' | 'doubles'; // Affects sideline boundaries
  enableKitchenFault: boolean; // Detect kitchen line faults
}

const DEFAULT_CONFIG: DecisionEngineConfig = {
  ballRadius: COURT.BALL_RADIUS,
  lineWidth: COURT.LINE_WIDTH,
  uncertaintyThreshold: 0.5,
  courtMode: 'doubles',
  enableKitchenFault: false,
};

// ---------------------------------------------------------------------------
// DecisionEngine
// ---------------------------------------------------------------------------

export class DecisionEngine {
  private p2p: P2PManager;
  private audio: AudioManager;
  private config: DecisionEngineConfig;

  // Event history for replay/review
  private callHistory: LineCallDecision[] = [];

  // Callback for UI updates
  public onDecision: ((decision: LineCallDecision) => void) | null = null;

  constructor(
    p2p: P2PManager,
    audio: AudioManager,
    config: Partial<DecisionEngineConfig> = {},
  ) {
    this.p2p = p2p;
    this.audio = audio;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a bounce event from the local CV pipeline.
   * Determines IN/OUT and broadcasts the result.
   */
  processBounce(event: BounceEvent): LineCallDecision {
    const decision = this.evaluateBounce(event);

    // Store in history
    this.callHistory.push(decision);

    // Notify UI
    this.onDecision?.(decision);

    // Trigger alerts based on decision
    this.triggerAlerts(decision);

    // Broadcast to peer device
    if (decision.result === CallResult.OUT) {
      this.p2p.sendEvent(MessageType.OUT_EVENT, {
        courtX: event.courtX,
        courtY: event.courtY,
        timestamp: event.timestamp,
        confidence: event.confidence,
        distanceFromLine: decision.distanceFromLine,
        nearestLine: decision.nearestLine,
      });
    } else if (decision.result === CallResult.IN) {
      this.p2p.sendEvent(MessageType.IN_EVENT, {
        courtX: event.courtX,
        courtY: event.courtY,
        timestamp: event.timestamp,
        confidence: event.confidence,
      });
    }

    return decision;
  }

  /**
   * Handle a bounce event received from the remote peer device.
   */
  processRemoteBounce(event: BounceEvent): void {
    // Remote device detected a bounce on their side
    // We trust their detection and trigger local alerts
    event.source = 'remote';
    const decision = this.evaluateBounce(event);

    this.callHistory.push(decision);
    this.onDecision?.(decision);
    this.triggerAlerts(decision);
  }

  // -------------------------------------------------------------------------
  // Core Logic: Boundary Check
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether a bounce point is IN or OUT.
   *
   * Boundary definitions (doubles):
   *   Left sideline:    X = 0
   *   Right sideline:   X = 240 (COURT.WIDTH)
   *   Near baseline:    Y = 0
   *   Far baseline:     Y = 528 (COURT.LENGTH) or Y = 264 (HALF_LENGTH)
   *   Kitchen line:     Y = HALF_LENGTH - KITCHEN_DEPTH
   *
   * A ball is IN if any part of the ball contacts the line.
   * The outer edge of the line is the legal boundary.
   * Therefore, effective boundary = line position + lineWidth/2 + ballRadius
   */
  private evaluateBounce(event: BounceEvent): LineCallDecision {
    const { courtX, courtY } = event;
    const compensation = this.config.ballRadius + (this.config.lineWidth / 2);

    // Compute distance from each boundary line
    // Positive = inside, Negative = outside
    const distances: Record<string, number> = {
      sideline_left: courtX + compensation, // Distance inside left sideline
      sideline_right: COURT.WIDTH - courtX + compensation, // Distance inside right sideline
      baseline_near: courtY + compensation, // Distance inside near baseline
      baseline_far: COURT.LENGTH - courtY + compensation, // Distance inside far baseline
    };

    // For singles, inner sidelines are at 18" from each side
    if (this.config.courtMode === 'singles') {
      distances.sideline_left = courtX - 18 + compensation; // Singles sideline at X=18
      distances.sideline_right = (COURT.WIDTH - 18) - courtX + compensation;
    }

    // Find the nearest boundary (minimum distance)
    let nearestLine = 'baseline_near';
    let minDistance = Infinity;

    for (const [lineName, distance] of Object.entries(distances)) {
      if (distance < minDistance) {
        minDistance = distance;
        nearestLine = lineName;
      }
    }

    // Raw result (without compensation — just for reference)
    const rawIn =
      courtX >= 0 &&
      courtX <= COURT.WIDTH &&
      courtY >= 0 &&
      courtY <= COURT.LENGTH;

    // Compensated result: ball is IN if it's within the expanded boundary
    const compensatedIn = minDistance >= 0;

    // Determine call result
    let result: CallResult;
    let compensatedResult: CallResult;

    if (event.confidence < this.config.uncertaintyThreshold) {
      result = CallResult.UNCERTAIN;
      compensatedResult = CallResult.UNCERTAIN;
    } else {
      result = rawIn ? CallResult.IN : CallResult.OUT;
      compensatedResult = compensatedIn ? CallResult.IN : CallResult.OUT;

      // Kitchen fault check
      if (
        this.config.enableKitchenFault &&
        compensatedIn &&
        courtY >= (COURT.HALF_LENGTH - COURT.KITCHEN_DEPTH) &&
        courtY <= COURT.HALF_LENGTH
      ) {
        compensatedResult = CallResult.KITCHEN_FAULT;
      }
    }

    return {
      result: compensatedResult, // Use compensated as the primary result
      bounceEvent: event,
      distanceFromLine: minDistance,
      nearestLine,
      compensatedResult,
    };
  }

  // -------------------------------------------------------------------------
  // Alert System
  // -------------------------------------------------------------------------

  /**
   * Trigger audio and haptic alerts based on the decision.
   */
  private triggerAlerts(decision: LineCallDecision): void {
    switch (decision.result) {
      case CallResult.OUT:
        // Play "OUT!" sound immediately
        this.audio.playOut();
        break;

      case CallResult.IN:
        // Optional: subtle confirmation sound
        // this.audio.playIn();
        break;

      case CallResult.KITCHEN_FAULT:
        this.audio.playOut(); // Same alert as OUT for kitchen faults
        break;

      case CallResult.UNCERTAIN:
        // No alert — don't make uncertain calls
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Query & Config
  // -------------------------------------------------------------------------

  /**
   * Get the call history for the current game.
   */
  getCallHistory(): LineCallDecision[] {
    return [...this.callHistory];
  }

  /**
   * Get the last N calls.
   */
  getLastCalls(n: number): LineCallDecision[] {
    return this.callHistory.slice(-n);
  }

  /**
   * Clear call history (new game).
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<DecisionEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): DecisionEngineConfig {
    return { ...this.config };
  }
}
