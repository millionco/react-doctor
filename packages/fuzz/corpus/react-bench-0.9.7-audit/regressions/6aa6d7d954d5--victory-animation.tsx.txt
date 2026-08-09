// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6aa6d7d954d5b7b876fef761dbfb3ffa9f708630824f9c2d2ab7d2b4b0a576fd
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
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Refs that always hold the latest prop values so that timer callbacks —
  // which are subscribed once and may outlive many re-renders — always use the
  // current `duration`, `easing`, `delay` and `onEnd`.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Ref for the latest visible `state.data` so `traverseQueue` can always start
  // a new interpolation from the currently displayed value.
  const stateDataRef = React.useRef(state.data);
  stateDataRef.current = state.data;

  const getEase = () => d3Ease[formatAnimationName(easingRef.current)];

  // ---- stable callbacks ----------------------------------------------------

  // `traverseQueue` is referenced by `functionToBeRunEachFrame` (when a step
  // finishes and the next queue entry should start) and vice-versa.  We break
  // the circular dependency with a ref so both callbacks can remain stable
  // (empty-ish dependency arrays) and always read the latest values via refs.
  const traverseQueueRef = React.useRef<() => void>(() => {});

  // Cancel whatever run is currently active — a subscribed timer loop and/or a
  // pending delayed start — so a superseded run can never render or complete
  // later.
  const cancelActiveRun = React.useCallback(() => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current) return;

      // Always read the latest duration so a mid-run prop change is adopted.
      const currentDuration = durationRef.current;
      const ease = getEase();

      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator.current(1);
        // Update the ref synchronously so that when traverseQueue starts the
        // next queued step it begins from this final value, not a stale one.
        stateDataRef.current = finalData;
        setState({
          data: finalData,
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

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const interpolatedData = interpolator.current(ease(step));
      stateDataRef.current = interpolatedData;
      setState({
        data: interpolatedData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer],
  );

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Start from the currently visible value — never from a superseded target.
      interpolator.current = victoryInterpolator(stateDataRef.current, nextData);

      // Reset step to zero, preserving delayed starts.
      if (delayRef.current) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            durationRef.current,
          );
        }, delayRef.current);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      }
    } else if (onEndRef.current) {
      // Always invoke the latest onEnd callback.
      onEndRef.current();
    }
  }, [timer, functionToBeRunEachFrame]);

  // Keep the ref in sync so `functionToBeRunEachFrame` can call the latest
  // `traverseQueue` without a circular `useCallback` dependency.
  traverseQueueRef.current = traverseQueue;

  // ---- effects -------------------------------------------------------------

  // Track the previous `data` prop by reference so the data effect can skip
  // its initial mount run (and any Strict Mode double-invocation) and only
  // react to *actual* data changes.
  const prevDataRef = React.useRef(data);

  // Initial mount: start the queue only if it already has entries (array data).
  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop and any pending delayed start on unmount so
    // completion can never fire afterward.
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Skip the mount run (and Strict Mode re-run) — the mount effect above
    // handles the initial queue.  Without this guard the effect would start a
    // spurious animation from `data` to `data` for non-array data.
    if (data === prevDataRef.current) {
      return;
    }
    prevDataRef.current = data;

    // Cancel any in-progress animation without flashing to the superseded
    // target.  The currently visible `state.data` (tracked via `stateDataRef`)
    // becomes the starting point for the replacement run.
    cancelActiveRun();

    // Set the tween queue to the new data.  For array data the entire array
    // is the ordered queue of targets; for single-object data it is wrapped.
    // A copy is used so `shift()` never mutates the caller's array.
    queue.current = Array.isArray(data)
      ? data.slice()
      : [data as AnimationStyle];

    // Start traversing the new queue from the current visible value.
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
