// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0e12e3d98f2c246501ce28ca26f656923d30c55bfa0f583285b011b023e899df
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const currentState = React.useRef(state);
  const hasInitialized = React.useRef(false);
  const traverseQueueRef = React.useRef<() => void>(() => undefined);
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  // Keep an in-flight animation tied to the latest props. In particular, the
  // timer callback must not retain an old duration, easing function, or onEnd.
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const updateState = React.useCallback((nextState: VictoryAnimationState) => {
    currentState.current = nextState;
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
      onEndRef.current?.();
      return;
    }

    const id = runID.current;
    interpolator.current = victoryInterpolator(
      currentState.current.data,
      queue.current[0],
    );

    const start = () => {
      if (id !== runID.current) return;
      delayID.current = undefined;
      loopID.current = timer.subscribe((elapsed) => {
        // A callback can already be queued when a replacement run cancels it.
        if (id !== runID.current || !interpolator.current) return;

        const currentDuration = durationRef.current;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          updateState({
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
          queue.current.shift();
          traverseQueueRef.current();
          return;
        }

        const ease = d3Ease[formatAnimationName(easingRef.current)];
        updateState({
          data: interpolator.current(ease(step)),
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
      }, durationRef.current);
    };

    if (delayRef.current) {
      delayID.current = setTimeout(start, delayRef.current);
    } else {
      start();
    }
  }, [timer, updateState]);
  traverseQueueRef.current = traverseQueue;

  React.useEffect(() => {
    return () => {
      cancelRun();
    };
  }, [cancelRun]);

  React.useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      if (queue.current.length) {
        traverseQueue();
      }
    } else {
      // Begin the replacement from the style currently on screen. Cancelling
      // first also makes delayed and queued callbacks from the old run inert.
      cancelRun();
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }
  }, [cancelRun, data, traverseQueue]);

  return children(state.data, state.animationInfo);
};
