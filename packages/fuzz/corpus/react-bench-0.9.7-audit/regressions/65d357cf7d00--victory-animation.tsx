// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 65d357cf7d00297a2c6db27a4bdc3829517c6698649e38e67be2140b5e694b01
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutId = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = React.useRef<number>(0);
  const isFirstDataEffect = React.useRef<boolean>(true);
  const prevDataRef = React.useRef<AnimationData>(data);

  // refs for latest prop values so active animation adopts them
  const latestDuration = React.useRef<number>(duration);
  const latestDelay = React.useRef<number>(delay);
  const latestOnEnd = React.useRef<(() => void) | undefined>(onEnd);
  const latestEase = React.useRef<(t: number) => number>(
    (d3Ease as any)[formatAnimationName(easing)] as (t: number) => number,
  );

  // keep latest props in refs - synchronous assignment for immediate adoption
  latestDuration.current = duration;
  latestDelay.current = delay;
  latestOnEnd.current = onEnd;
  latestEase.current = (d3Ease as any)[formatAnimationName(easing)] as (t: number) => number;

  // keep latest state for closure use - synchronous
  const stateRef = React.useRef<VictoryAnimationState>(state);
  stateRef.current = state;

  const clearTimers = React.useCallback(() => {
    if (delayTimeoutId.current !== undefined) {
      clearTimeout(delayTimeoutId.current);
      delayTimeoutId.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    const gen = generation.current;

    // If queue empty, finish with latest onEnd if still current generation
    if (queue.current.length === 0) {
      if (gen !== generation.current) {
        return;
      }
      const currentOnEnd = latestOnEnd.current;
      if (currentOnEnd) {
        currentOnEnd();
      }
      return;
    }

    const nextData = queue.current[0];

    // Use currently visible style as start (from ref to avoid stale closure)
    const currentVisibleData = stateRef.current.data;
    interpolator.current = victoryInterpolator(currentVisibleData, nextData);

    const startAnimation = () => {
      if (gen !== generation.current) {
        return;
      }
      // Ensure delay timeout id cleared when we actually start
      delayTimeoutId.current = undefined;

      loopID.current = timer.subscribe((elapsed: number) => {
        // Guard against superseded runs
        if (gen !== generation.current) {
          return;
        }
        if (!interpolator.current) {
          return;
        }
        const currentDuration = latestDuration.current;
        const currentEase = latestEase.current;

        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          if (gen !== generation.current) {
            return;
          }
          setState({
            data: interpolator.current(1),
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          // Ensure this gen is still current before mutating queue
          if (gen !== generation.current) {
            return;
          }
          queue.current.shift();
          traverseQueue();
          return;
        }

        if (gen !== generation.current) {
          return;
        }
        setState({
          data: interpolator.current(currentEase(step)),
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      }, latestDuration.current);
    };

    const currentDelay = latestDelay.current;
    if (currentDelay) {
      delayTimeoutId.current = setTimeout(() => {
        startAnimation();
      }, currentDelay);
    } else {
      startAnimation();
    }
  }, [timer]);

  // Initial mount: start queue if present, and cleanup on unmount to stop timer
  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      // unmount: stop active timer and prevent completion
      if (delayTimeoutId.current !== undefined) {
        clearTimeout(delayTimeoutId.current);
        delayTimeoutId.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      generation.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data change: continue from currently visible style toward new data,
  // without flashing superseded target, and complete only replacement run.
  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      prevDataRef.current = data;
      return;
    }

    // If data is deep-equal, don't restart animation; let duration/easing/onEnd be picked up via refs
    if (isEqual(prevDataRef.current, data)) {
      prevDataRef.current = data;
      return;
    }

    prevDataRef.current = data;

    // Invalidate any in-progress animation / delayed start
    generation.current += 1;
    clearTimers();

    // New queue is whole new data (from visible style toward first element, then ordered rest)
    queue.current = Array.isArray(data) ? (data as AnimationStyle[]).slice() : [data as AnimationStyle];

    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
