/**
 * useLineJudge.ts — the one hook LiveGameScreen needs.
 * Owns the poll loop, forwards outbound contacts to the peer, surfaces calls
 * and engine status to the UI.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { engine, nowSeconds, type LineCall, type EngineStatus } from '../native/NativeEngine';
import { SyncBridge } from '../native/SyncBridge';
import type { P2PManager } from '../engine/P2PManager';

export type GameContext =
  | { type: 'rally'; targetSide: 'A' | 'B' }
  | { type: 'serve'; targetSide: 'A' | 'B'; box: 'left' | 'right' };

export function useLineJudge(p2p: P2PManager | null) {
  const [lastCall, setLastCall] = useState<LineCall | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const bridge = useRef<SyncBridge | null>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (p2p) {
      bridge.current = new SyncBridge(p2p);
      bridge.current.start();
      engine().setPeerConnected(true);
    } else {
      engine().setPeerConnected(false);
    }
    const loop = () => {
      const { outbound, calls } = engine().poll(nowSeconds());
      if (outbound.length && bridge.current) bridge.current.sendOutbound(outbound);
      if (calls.length) setLastCall(calls[calls.length - 1]);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    const statusTimer = setInterval(() => setStatus(engine().status()), 1000);
    return () => {
      cancelAnimationFrame(raf.current);
      clearInterval(statusTimer);
      bridge.current?.stop();
    };
  }, [p2p]);

  const setContext = useCallback((ctx: GameContext) => {
    const side = ctx.targetSide === 'B' ? 1 : 0;
    if (ctx.type === 'rally') engine().setContext(0, side as 0 | 1, 1);
    else engine().setContext(1, side as 0 | 1, ctx.box === 'right' ? 1 : -1);
  }, []);

  const resetPlay = useCallback(() => engine().resetPlay(), []);

  return { lastCall, status, setContext, resetPlay };
}
