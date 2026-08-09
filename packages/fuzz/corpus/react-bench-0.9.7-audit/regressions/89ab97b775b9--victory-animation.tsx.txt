// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 89ab97b775b9c2fd231492f6bba13291aab0f040bc1e91b2c931582bd622f8f5
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

  // ---------------------------------------------------------------------------
  // Refs that mirror the latest props so that an in-flight animation always
  // adopts the newest `duration`, `easing` and `onEnd` without needing to
  // resubscribe.
  // ---------------------------------------------------------------------------
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // ---------------------------------------------------------------------------
  // Animation state refs.
  //
  // `currentDataRef` always holds the most recently *displayed* style.  It is
  // updated on every frame so that, when `data` changes mid-run, the new
  // animation can start from the currently-visible value instead of flashing
  // to the superseded target.
  // ---------------------------------------------------------------------------
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const timeoutIDRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const currentDataRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  // Guard that lets us distinguish the initial mount from subsequent `data`
  // changes inside the single effect below.
  const isFirstRunRef = React.useRef(true);
  // Guard that prevents any work after unmount.
  const mountedRef = React.useRef(true);

  // Ref indirection so that `traverseQueue` (subscribed to the timer) can call
  // `functionToBeRunEachFrame` and vice-versa while both remain stable.
  const traverseQueueRef = React.useRef<() => void>(() => {});

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Cancel whatever animation is currently running (timer + pending delay). */
  const stopAnimation = React.useCallback(() => {
    if (timeoutIDRef.current !== undefined) {
      clearTimeout(timeoutIDRef.current);
      timeoutIDRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, [timer]);

  /**
   * Per-frame callback registered with the timer.  Reads from refs so that it
   * always uses the latest `duration` / `easing` even when those props change
   * after the subscription was created.
   */
  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!mountedRef.current || !interpolatorRef.current) return;

      const currentDuration = durationRef.current;
      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolatorRef.current(1);
        currentDataRef.current = finalData;
        setState({
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        if (loopIDRef.current !== undefined) {
          timer.unsubscribe(loopIDRef.current);
          loopIDRef.current = undefined;
        }
        queueRef.current.shift();
        // Start the next queued step (or fire `onEnd` when the queue is empty).
        traverseQueueRef.current();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const interpolatedData = interpolatorRef.current(
        easeRef.current(step),
      );
      currentDataRef.current = interpolatedData;
      setState({
        data: interpolatedData,
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    },
    [timer],
  );

  /**
   * Pop the next target off the queue, build an interpolator from the
   * currently-visible style, and subscribe the per-frame callback.
   *
   * When the queue is empty the latest `onEnd` is invoked.
   */
  const traverseQueue = React.useCallback(() => {
    if (!mountedRef.current) return;

    if (queueRef.current.length) {
      const nextData = queueRef.current[0];

      // Build the interpolator from the *currently visible* style so that a
      // mid-run data change never flashes to a superseded target.
      interpolatorRef.current = victoryInterpolator(
        currentDataRef.current,
        nextData,
      );

      const currentDelay = delayRef.current;
      if (currentDelay) {
        timeoutIDRef.current = setTimeout(() => {
          timeoutIDRef.current = undefined;
          if (!mountedRef.current) return;
          loopIDRef.current = timer.subscribe(
            functionToBeRunEachFrame,
            durationRef.current,
          );
        }, currentDelay);
      } else {
        loopIDRef.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  }, [timer, functionToBeRunEachFrame]);

  // Keep the ref in sync (stable identity — updated every render but always
  // the same function).
  traverseQueueRef.current = traverseQueue;

  // ---------------------------------------------------------------------------
  // Single effect that handles both mount and `data` changes.
  //
  // On mount it kicks off the initial queue (preserving the convention that the
  // first element of an array is the starting point while subsequent elements
  // are targets).
  //
  // On a `data` change the cleanup first stops any in-flight animation, then
  // the effect rebuilds the queue from the new `data` and starts animating
  // from the currently-visible style — no flash, no stale completion.
  // ---------------------------------------------------------------------------
  React.useEffect(() => {
    mountedRef.current = true;

    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      // Mount — the queue ref was initialised from the initial `data`.
      if (queueRef.current.length) {
        traverseQueue();
      }
    } else {
      // `data` changed mid-lifecycle.  Build a fresh queue where every element
      // is a target (the animation starts from the current visible style).
      queueRef.current = Array.isArray(data) ? data.slice() : [data];
      traverseQueue();
    }

    return () => {
      // Runs on unmount **and** before each subsequent `data` change, ensuring
      // a superseded run can never render or complete later.
      stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Final safety net: if the component unmounts while the effect above has
  // already been cleaned up, make sure the timer is stopped and the mounted
  // flag is cleared.
  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopAnimation();
    };
  }, [stopAnimation]);

  return children(state.data, state.animationInfo);
};
