// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d0bf7d4a7aa129da3311ea81ebba2a2ba70b356a4bf142484ca6fc4eb97b5227
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

/**
 * Normalize the `data` prop into an ordered queue of styles to animate through.
 * When `data` is an array, the first element is the initial style and the
 * remaining elements are queued animation steps. When `data` is a single
 * object, the queue contains just that one target.
 */
const toQueue = (data: AnimationData): AnimationStyle[] =>
  Array.isArray(data) ? data.slice() : [data];

export const VictoryAnimation = ({
  duration: durationProp = DEFAULT_DURATION,
  easing: easingProp = "quadInOut",
  delay = 0,
  data,
  children,
  onEnd,
}: VictoryAnimationProps) => {
  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  const timer = React.useContext(TimerContext).animationTimer;

  // Refs holding the latest prop values so that the animation loop always uses
  // the most recent settings without needing to resubscribe.
  const durationRef = React.useRef(durationProp);
  const easingRef = React.useRef(easingProp);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  durationRef.current = durationProp;
  easingRef.current = easingProp;
  onEndRef.current = onEnd;
  delayRef.current = delay;

  // Mutable animation state kept in refs so the per-frame callback and the
  // data-change effect always read/write the latest values without going stale.
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // The currently visible style, kept in sync with `state.data` so effects can
  // read it without depending on React state directly.
  const dataRef = React.useRef<AnimationStyle>(state.data);
  dataRef.current = state.data;

  // A monotonically increasing id used to invalidate superseded animation runs.
  const runIDRef = React.useRef(0);

  const cancelTimer = React.useCallback(() => {
    if (delayTimeoutRef.current !== null) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = null;
    }
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, [timer]);

  // `traverseQueue` is stored in a ref so that `step` (a useCallback) can call
  // the latest version without it being a dependency, and so that the
  // data-change effect always uses the latest implementation.
  const traverseQueueRef = React.useRef<(runID: number) => void>(() => {});
  const stepRef = React.useRef<(runID: number, elapsed: number) => void>(
    () => {},
  );

  // Per-frame callback. Reads everything from refs so it always uses the latest
  // props. `runID` ties this closure to a specific animation run; if the run has
  // been superseded, the callback becomes a no-op.
  stepRef.current = (runID: number, elapsed: number) => {
    if (runID !== runIDRef.current || !interpolatorRef.current) {
      return;
    }

    const duration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const t = duration ? elapsed / duration : 1;

    if (t >= 1) {
      // Run completed. Render the final style and stop animating.
      const finalData = interpolatorRef.current(1);
      // Keep `dataRef` in sync immediately so that the next queued step (which
      // may be started synchronously below) interpolates from this completed
      // value rather than a stale one.
      dataRef.current = finalData;
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
      // Advance to the next queued step, if any.
      traverseQueueRef.current(runID);
      return;
    }

    const easeName = easingRef.current;
    const ease = d3Ease[formatAnimationName(easeName)];
    setState({
      data: interpolatorRef.current(ease(t)),
      animationInfo: {
        progress: t,
        animating: true,
      },
    });
  };

  traverseQueueRef.current = (runID: number) => {
    if (runID !== runIDRef.current) {
      return;
    }
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      // Interpolate from the currently visible style toward the next target so
      // that mid-run data changes hand off smoothly without flashing the
      // superseded target.
      interpolatorRef.current = victoryInterpolator(dataRef.current, nextData);

      const duration = durationRef.current;
      const localDelay = delayRef.current;
      cancelTimer();
      if (localDelay) {
        delayTimeoutRef.current = setTimeout(() => {
          delayTimeoutRef.current = null;
          if (runID !== runIDRef.current) return;
          loopIDRef.current = timer.subscribe(
            (elapsed: number) => stepRef.current(runID, elapsed),
            duration,
          );
        }, localDelay);
      } else {
        loopIDRef.current = timer.subscribe(
          (elapsed: number) => stepRef.current(runID, elapsed),
          duration,
        );
      }
    } else {
      // Queue is exhausted; invoke the latest `onEnd` once.
      const cb = onEndRef.current;
      if (cb) {
        cb();
      }
    }
  };

  // React to `data` changes (and the initial mount). On mount the queue/state
  // are already initialized; just start traversing queued steps. On subsequent
  // changes, hand off from the currently visible style to the new data without
  // flashing the superseded target, and only complete the replacement run.
  const mountedRef = React.useRef(false);
  React.useEffect(() => {
    if (!mountedRef.current) {
      // First run (mount).
      mountedRef.current = true;
      if (queueRef.current.length) {
        const runID = runIDRef.current;
        traverseQueueRef.current(runID);
      }
      return;
    }

    // Data changed: start a fresh run. Incrementing the run id invalidates any
    // superseded run (its per-frame callback and onEnd become no-ops), so it
    // will neither render nor complete later.
    const runID = ++runIDRef.current;

    // Stop the previous animation immediately. We do NOT force-complete it (no
    // flash of the superseded target); we continue from the currently visible
    // style toward the new data instead.
    cancelTimer();

    // Build the new queue from the incoming data.
    queueRef.current = toQueue(data);

    // Begin traversing the new queue from the current visible style.
    traverseQueueRef.current(runID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Unmount: invalidate any in-progress run and stop the active timer / pending
  // delay so completion cannot fire afterward.
  React.useEffect(() => {
    return () => {
      runIDRef.current = runIDRef.current + 1;
      cancelTimer();
    };
  }, [cancelTimer]);

  return children(state.data, state.animationInfo);
};
