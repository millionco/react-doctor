// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 8c171cc1185fcdf7525c1bf95f68ba0defdbce50c5949ba1e082a9b654110a72
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

/**
 * Single animation object to interpolate
 */
export type AnimationStyle = { [key: string]: string | number };
/**
 * Animation styles to interpolate
 */

export type AnimationData = AnimationStyle | AnimationStyle[];

export type AnimationEasing =
  | "back"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "bounce"
  | "bounceIn"
  | "bounceOut"
  | "bounceInOut"
  | "circle"
  | "circleIn"
  | "circleOut"
  | "circleInOut"
  | "linear"
  | "linearIn"
  | "linearOut"
  | "linearInOut"
  | "cubic"
  | "cubicIn"
  | "cubicOut"
  | "cubicInOut"
  | "elastic"
  | "elasticIn"
  | "elasticOut"
  | "elasticInOut"
  | "exp"
  | "expIn"
  | "expOut"
  | "expInOut"
  | "poly"
  | "polyIn"
  | "polyOut"
  | "polyInOut"
  | "quad"
  | "quadIn"
  | "quadOut"
  | "quadInOut"
  | "sin"
  | "sinIn"
  | "sinOut"
  | "sinInOut";

export interface VictoryAnimationProps {
  children: (style: AnimationStyle, info: AnimationInfo) => React.ReactElement;
  duration?: number;
  easing?: AnimationEasing;
  delay?: number;
  onEnd?: () => void;
  data: AnimationData;
}

export interface VictoryAnimationState {
  data: AnimationStyle;
  animationInfo: AnimationInfo;
}

export interface AnimationInfo {
  progress: number;
  animating: boolean;
  terminating?: boolean;
}

export interface VictoryAnimation {
  context: React.ContextType<typeof TimerContext>;
}

/** d3-ease changed the naming scheme for ease from "linear" -> "easeLinear" etc. */
const formatAnimationName = (name: AnimationEasing) => {
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  return `ease${capitalizedName}`;
};

const DEFAULT_DURATION = 1000;

export const VictoryAnimation = ({
  duration = DEFAULT_DURATION,
  easing = "quadInOut",
  delay = 0,
  data,
  children,
  onEnd,
}: VictoryAnimationProps) => {
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: { progress: 0, animating: false },
  });
  const timer = React.useContext(TimerContext).animationTimer;
  const stateRef = React.useRef(state);
  const queue = React.useRef<AnimationStyle[]>([]);
  const loopID = React.useRef<number | undefined>();
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>();
  const runID = React.useRef(0);
  const traverseQueueRef = React.useRef<() => void>(() => undefined);
  const initialized = React.useRef(false);
  const previousData = React.useRef<AnimationData>(data);
  const settings = React.useRef({ duration, easing, delay, onEnd });

  // Keep callbacks and the frame loop in agreement even before effects run.
  settings.current = { duration, easing, delay, onEnd };

  const updateState = React.useCallback((nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const cancelRun = React.useCallback(() => {
    runID.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (!queue.current.length) {
      settings.current.onEnd?.();
      return;
    }

    const target = queue.current[0];
    const interpolate = victoryInterpolator(stateRef.current.data, target);
    const thisRun = ++runID.current;
    const start = () => {
      if (thisRun !== runID.current) return;
      delayID.current = undefined;
      const { duration: runDuration, easing: runEasing } = settings.current;
      const ease = d3Ease[formatAnimationName(runEasing)];
      loopID.current = timer.subscribe((elapsed: number) => {
        // A timer callback can already be queued when a replacement run begins.
        if (thisRun !== runID.current) return;

        const step = runDuration ? elapsed / runDuration : 1;
        if (step >= 1) {
          updateState({
            data: interpolate(1),
            animationInfo: { progress: 1, animating: false, terminating: true },
          });
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          queue.current.shift();
          traverseQueueRef.current();
          return;
        }

        updateState({
          data: interpolate(ease(step)),
          animationInfo: { progress: step, animating: true },
        });
      }, runDuration);
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(start, settings.current.delay);
    } else {
      start();
    }
  }, [timer, updateState]);

  traverseQueueRef.current = traverseQueue;

  React.useEffect(() => {
    const firstRun = !initialized.current;
    const dataChanged = !firstRun && previousData.current !== data;

    if (firstRun) {
      initialized.current = true;
      queue.current = Array.isArray(data) ? data.slice(1) : [];
    } else if (dataChanged) {
      // Start replacement data at the style that is actually on screen.
      queue.current = Array.isArray(data) ? data.slice() : [data];
      previousData.current = data;
    }

    if (queue.current.length) {
      traverseQueue();
    }

    return cancelRun;
  }, [cancelRun, data, duration, easing, delay, onEnd, traverseQueue]);

  return children(state.data, state.animationInfo);
};
