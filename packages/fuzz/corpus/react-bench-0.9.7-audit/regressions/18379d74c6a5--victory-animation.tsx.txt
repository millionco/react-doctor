// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 18379d74c6a529cf68f25cfe2e1d4cfced16af3ed9d590336802f78760815d32
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
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const latest = React.useRef({ duration, easing, delay, onEnd });
  latest.current = { duration, easing, delay, onEnd };
  const visible = React.useRef(state.data);
  const run = React.useRef<{
    id: number;
    queue: AnimationStyle[];
    target?: AnimationStyle;
    loopID?: number;
    timeout?: ReturnType<typeof setTimeout>;
  }>({ id: 0, queue: Array.isArray(data) ? data.slice(1) : [] });
  const previous = React.useRef({ data, duration, easing, delay });
  const mounted = React.useRef(false);

  const updateState = React.useCallback((next: VictoryAnimationState) => {
    visible.current = next.data;
    setState(next);
  }, []);

  const cancelRun = React.useCallback(() => {
    const current = run.current;
    current.id += 1;
    if (current.loopID !== undefined) {
      timer.unsubscribe(current.loopID);
      current.loopID = undefined;
    }
    if (current.timeout !== undefined) {
      clearTimeout(current.timeout);
      current.timeout = undefined;
    }
  }, [timer]);

  const startNext = React.useCallback(() => {
    const current = run.current;
    const id = current.id;
    const nextData = current.queue.shift();
    if (!nextData) {
      latest.current.onEnd?.();
      return;
    }

    current.target = nextData;
    const interpolator = victoryInterpolator(visible.current, nextData);
    const subscribe = () => {
      if (run.current.id !== id) return;
      const { duration: currentDuration, easing: currentEasing } = latest.current;
      const ease = d3Ease[formatAnimationName(currentEasing)];
      current.timeout = undefined;
      current.loopID = timer.subscribe((elapsed: number) => {
        if (run.current.id !== id) return;
        const step = currentDuration ? elapsed / currentDuration : 1;
        if (step >= 1) {
          updateState({
            data: interpolator(1),
            animationInfo: { progress: 1, animating: false, terminating: true },
          });
          if (current.loopID !== undefined) {
            timer.unsubscribe(current.loopID);
            current.loopID = undefined;
          }
          current.target = undefined;
          startNext();
          return;
        }
        updateState({
          data: interpolator(ease(step)),
          animationInfo: { progress: step, animating: true },
        });
      }, currentDuration);
    };

    if (latest.current.delay) {
      current.timeout = setTimeout(subscribe, latest.current.delay);
    } else {
      subscribe();
    }
  }, [timer, updateState]);

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (run.current.queue.length) startNext();
      return;
    }

    const old = previous.current;
    const dataChanged = old.data !== data;
    const settingsChanged =
      old.duration !== duration || old.easing !== easing || old.delay !== delay;
    previous.current = { data, duration, easing, delay };

    if (!dataChanged && !settingsChanged) return;

    // A replacement always starts at what is actually on screen. Never finish
    // the old target first: it may no longer be part of the requested queue.
    const remaining = dataChanged
      ? Array.isArray(data) ? data.slice() : [data]
      : run.current.target
        ? [run.current.target, ...run.current.queue]
        : run.current.queue.slice();
    cancelRun();
    run.current.queue = remaining;
    run.current.target = undefined;
    if (remaining.length) startNext();
  }, [data, delay, duration, easing, cancelRun, startNext]);

  React.useEffect(() => cancelRun, [cancelRun]);

  return children(state.data, state.animationInfo);
};
