// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 7ad139ca8b59d52d0772a627e84a83e156b60ac3ed398545974c23b179f7b678
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

  // Refs that always hold the latest prop values. The animation loop reads
  // from these instead of closing over the props directly so that an
  // in-progress animation always adopts the newest `duration`, `easing`,
  // `delay`, and `onEnd` rather than finishing with stale settings.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef<(() => void) | undefined>(onEnd);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Mirror of the currently visible (rendered) data. New interpolations
  // always start from this value so that a mid-run `data` change hands off
  // smoothly without ever flashing the superseded target.
  const dataRef = React.useRef<AnimationStyle>(state.data);
  dataRef.current = state.data;

  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolatorRef = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // A monotonically increasing "run" token. Every time we begin a fresh run
  // (mount, `data` change, or unmount) we bump this. Steps capture the token
  // when they start and bail out if it no longer matches, which guarantees a
  // superseded run can neither render nor complete (call `onEnd`) later.
  const runGenRef = React.useRef(0);
  const mountedRef = React.useRef(false);

  // Tear down whatever step is currently active (a pending delayed start
  // and/or a running timer subscription) without firing any callbacks.
  const cancelActiveStep = () => {
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  };

  const traverseQueue = () => {
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      // Always interpolate from the currently visible value.
      interpolatorRef.current = victoryInterpolator(dataRef.current, nextData);

      // Capture the current run token so this step can detect if it has been
      // superseded before it ever renders or completes.
      const runGen = runGenRef.current;
      const runStep = (elapsed: number) => {
        // If a newer run has started, this step is superseded: do not render,
        // do not complete, do not call `onEnd`.
        if (runGen !== runGenRef.current || !interpolatorRef.current) {
          return;
        }

        const stepDuration = durationRef.current;
        // Step can generate imprecise values, sometimes greater than 1
        // if this happens set the state to 1 and return, cancelling the timer
        const step = stepDuration ? elapsed / stepDuration : 1;

        if (step >= 1) {
          const finalData = interpolatorRef.current(1);
          // Keep the visible-data mirror in sync immediately so the next
          // queued step interpolates from this step's end value rather than
          // a stale render value.
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
          // Re-check the run token before advancing: a `data` change may have
          // occurred synchronously while this frame was processing.
          if (runGen !== runGenRef.current) {
            return;
          }
          traverseQueue();
          return;
        }

        // If we're not at the end of the timer, set the state by passing
        // current step value that's transformed by the ease function to the
        // interpolator, which is cached for performance whenever props are
        // received
        setState({
          data: interpolatorRef.current(easeRef.current(step)),
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      };

      const stepDelay = delayRef.current;
      if (stepDelay) {
        delayTimeoutRef.current = setTimeout(() => {
          delayTimeoutRef.current = undefined;
          // A newer run may have superseded this delayed start.
          if (runGen !== runGenRef.current) {
            return;
          }
          loopIDRef.current = timer.subscribe(runStep, durationRef.current);
        }, stepDelay);
      } else {
        loopIDRef.current = timer.subscribe(runStep, durationRef.current);
      }
    } else {
      // The queue is exhausted: invoke the latest `onEnd` only.
      const cb = onEndRef.current;
      if (cb) {
        cb();
      }
    }
  };

  React.useEffect(() => {
    if (!mountedRef.current) {
      // First mount. The initial state already reflects `data[0]` (or `data`
      // for a plain object). Seed the queue with the remaining array entries,
      // or - for a plain object - the object itself so that `onEnd` still
      // fires once the (no-op) tween completes, matching the historical
      // contract relied upon by callers such as `VictoryTransition`.
      mountedRef.current = true;
      queueRef.current = Array.isArray(data) ? data.slice(1) : [data];
      if (queueRef.current.length) {
        runGenRef.current++;
        traverseQueue();
      }
      return;
    }

    // `data` changed mid-run (or while idle). Supersede any active run so it
    // can neither render nor complete, then start a replacement run that
    // tweens from the currently visible style toward the new data.
    runGenRef.current++;
    cancelActiveStep();
    queueRef.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Unmounting must tear down the active timer so that completion cannot fire
  // afterward. This cleanup runs once on unmount: it invalidates the in-flight
  // run (so any pending delayed start no-ops), clears a pending delayed start,
  // and unsubscribes the running timer callback.
  React.useEffect(() => {
    return () => {
      runGenRef.current++;
      cancelActiveStep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
