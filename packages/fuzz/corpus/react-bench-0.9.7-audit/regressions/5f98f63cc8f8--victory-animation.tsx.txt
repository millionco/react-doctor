// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5f98f63cc8f8bc92699b4a3455251f8fa7bad3e4452cead278d89a5c91bbe2ba
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

  // The most recent visible style. Updated synchronously whenever we compute a
  // new interpolated value so that a mid-run hand-off always starts from the
  // value that is actually on screen.
  const visibleDataRef = React.useRef<AnimationStyle>(state.data);

  // Refs mirroring the latest prop values. The per-frame callback is captured
  // by the timer at subscription time, so it must read these refs (rather than
  // closed-over props) to always adopt the most recent `duration`, `easing`,
  // `delay`, and `onEnd`.
  const timerRef = React.useRef(timer);
  timerRef.current = timer;
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;
  delayRef.current = delay;
  // Keep the visible-data ref in sync with whatever was last rendered.
  visibleDataRef.current = state.data;

  // Stop the active subscription and any pending (delayed) start. A superseded
  // run is fully cancelled so it can neither render nor complete later.
  const cancelCurrentRun = React.useCallback(() => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timerRef.current.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, []);

  // `traverseQueue` is referenced from the (stable) per-frame callback, so we
  // indirection through a ref to avoid a stale closure while keeping the frame
  // callback referentially stable.
  const traverseQueueRef = React.useRef<() => void>(() => {});

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current) return;

      const currentDuration = durationRef.current;
      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
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
        // Cancel the just-finished run before starting the next queued step.
        cancelCurrentRun();
        queue.current.shift();
        traverseQueueRef.current();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const interpolated = interpolator.current(easeRef.current(step));
      visibleDataRef.current = interpolated;
      setState({
        data: interpolated,
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    },
    [cancelCurrentRun],
  );

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      const start = () => {
        loopID.current = timerRef.current.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      // Preserve delayed starts for every queued step.
      if (delayRef.current) {
        timeoutID.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      // Only the latest `onEnd` is invoked, and only when the active queue
      // actually completes.
      onEndRef.current();
    }
  };

  // Track the `data` prop reference so the data-change effect can distinguish a
  // genuine change from the initial mount invocation.
  const lastDataRef = React.useRef<AnimationData>(data);

  React.useEffect(() => {
    // Initial mount: kick off the ordered queue (if any). For a single
    // (non-array) data object the visible style already matches `data`, so no
    // run is started until `data` changes.
    lastDataRef.current = data;
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    // Clean up the active run on unmount so completion cannot fire afterward.
    return () => {
      cancelCurrentRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Skip the mount invocation (handled above) and no-op re-runs where the
    // `data` reference has not actually changed.
    if (lastDataRef.current === data) {
      return;
    }
    lastDataRef.current = data;

    // `data` changed mid-life (possibly mid-run). Hand off from the currently
    // visible style toward the new data without flashing the superseded target.
    // The superseded run is cancelled so it will neither render nor complete.
    cancelCurrentRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
