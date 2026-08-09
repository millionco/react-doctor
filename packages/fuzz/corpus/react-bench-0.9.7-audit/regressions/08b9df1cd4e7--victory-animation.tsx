// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 08b9df1cd4e7d7d1dc15ffa1b3f9f888b4e601f01a0fe6063a045434916c971f
import React from "react";
import isEqual from "react-fast-compare";
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
  const ease = d3Ease[formatAnimationName(easing)];

  // Refs that mirror the latest props so an animation that is already running
  // can adopt new `duration`, `easing`, and `onEnd` values without being
  // resubscribed. The active timer callback reads from these refs each frame,
  // which means a prop change mid-run takes effect immediately.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = ease;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // The most recently rendered style. New runs interpolate from this value so
  // that a prop change mid-run continues smoothly from the visible style
  // instead of flashing to a superseded target.
  const visibleDataRef = React.useRef<AnimationStyle>(state.data);

  // A monotonically increasing token used to invalidate runs that have been
  // superseded (by a `data` change). A superseded run's pending delayed-start
  // timeout checks this token and bails out, so it can neither subscribe nor
  // complete (call `onEnd`) later.
  const runTokenRef = React.useRef(0);

  // The data value from the previous render, so we only hand off when `data`
  // actually changes (by value) rather than on every referentially-distinct
  // but equivalent re-render.
  const prevDataRef = React.useRef<AnimationData | undefined>(undefined);
  const hasMountedRef = React.useRef(false);

  // Pending delayed-start timeout id so it can be cancelled on handoff/unmount.
  const delayTimeoutRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  // Kept in a ref so the stable per-frame callback can advance the queue without
  // a circular `useCallback` dependency.
  const traverseQueueRef = React.useRef<() => void>(() => {});

  const unsubscribeLoop = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const cancelDelay = React.useCallback(() => {
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
  }, []);

  // Cancel any active run, invalidating it so it cannot render or complete
  // later. The visible style is preserved as the starting point for the next run.
  const abortActiveRun = React.useCallback(() => {
    runTokenRef.current++;
    unsubscribeLoop();
    cancelDelay();
  }, [unsubscribeLoop, cancelDelay]);

  // The per-frame callback. It is stable (via `useCallback`) and reads from
  // refs, so the timer subscription always invokes the freshest logic and the
  // latest `duration` / `easing` are applied to the active animation. The next
  // queue step is invoked through `traverseQueueRef` to avoid a circular dep.
  const runFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current) {
        return;
      }

      // `duration` is read live so a change mid-run takes effect immediately.
      const currentDuration = durationRef.current;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        // Finalize this step at the requested target style.
        const finalData = interpolator.current(1);
        visibleDataRef.current = finalData;
        setState({
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        unsubscribeLoop();
        queue.current.shift();
        traverseQueueRef.current();
        return;
      }

      const easedStep = easeRef.current(step);
      const interpolated = interpolator.current(easedStep);
      visibleDataRef.current = interpolated;
      setState({
        data: interpolated,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [unsubscribeLoop],
  );

  // Begin animating toward the next item in the queue. Reads the latest prop
  // values from refs so a single function instance works for every step and
  // the active animation always uses the newest `duration`/`easing`/`onEnd`.
  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target so
      // chained steps and mid-run data changes never flash backward.
      interpolator.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      const token = runTokenRef.current;
      const startSubscription = () => {
        // Bail out if this run was superseded while waiting for the delay.
        if (token !== runTokenRef.current) {
          return;
        }
        loopID.current = timer.subscribe(runFrame, durationRef.current);
      };

      if (delayRef.current) {
        cancelDelay();
        delayTimeoutRef.current = setTimeout(
          startSubscription,
          delayRef.current,
        );
      } else {
        startSubscription();
      }
    } else {
      // Queue is empty: the run is complete. Invoke only the latest `onEnd`.
      if (onEndRef.current) {
        onEndRef.current();
      }
    }
  }, [timer, cancelDelay, runFrame]);

  traverseQueueRef.current = traverseQueue;

  // On unmount, stop the active timer and cancel any pending delayed start so
  // completion (and therefore `onEnd`) cannot fire afterward. (In React Strict
  // mode this cleanup also runs for the simulated unmount/remount; the data
  // effect below resumes an interrupted run.)
  React.useEffect(() => {
    return () => {
      abortActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle initial mount and genuine `data` changes. A referentially-distinct
  // but value-equal re-render does NOT restart the animation, which lets an
  // active run adopt new `onEnd`/`duration`/`easing` via the refs above.
  React.useEffect(() => {
    if (!hasMountedRef.current) {
      // Initial mount: set up the queue and start. For array data, `data[0]`
      // is the starting style and `data[1..]` are the ordered targets. For a
      // single object, animate from the current style to that object.
      hasMountedRef.current = true;
      queue.current = Array.isArray(data) ? data.slice(1) : [data];
      prevDataRef.current = data;
      traverseQueue();
      return;
    }

    if (!isEqual(prevDataRef.current, data)) {
      // Genuine data change: abort the superseded run (including any pending
      // delayed start) so it can neither render nor complete later, then
      // continue from the currently visible style toward the new data without
      // flashing the old target.
      prevDataRef.current = data;
      abortActiveRun();
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
      return;
    }

    // Data is unchanged. If an in-progress run was interrupted (e.g. by a
    // StrictMode remount clearing the active subscription) but the queue still
    // has targets to animate, resume from the currently visible style. An
    // already-active run is left alone so redundant re-renders don't restart it.
    if (
      queue.current.length &&
      loopID.current === undefined &&
      delayTimeoutRef.current === undefined
    ) {
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
