// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 989fa05f2cdeb88188296857cd5a5df1d33982da43b8494d2f7e3b2fab0ad084
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

  // ---- Latest-prop refs so the active animation always reads current values ----
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // ---- Animation state refs ----
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  // Tracks the currently-visible (interpolated) style so that a data change
  // can hand off from the exact value the user is seeing.
  const currentDataRef = React.useRef<AnimationStyle>(state.data);
  // Generation counter – each data change (or replacement run) bumps it.
  // A per-frame callback captured with an older generation is superseded and
  // must not render or complete.
  const runRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  // Tracks the data value we last processed so the data effect can skip the
  // initial mount (and StrictMode re-invocations) without restarting.
  const prevDataRef = React.useRef<AnimationData>(data);

  // ---- Stable function refs (mutated every render, always call the latest) ----
  const traverseQueueRef = React.useRef<() => void>(() => {});
  const startStepRef = React.useRef<() => void>(() => {});
  const runFrameRef = React.useRef<(elapsed: number) => void>(() => {});

  // Cancel whatever step is currently active (timer subscription + pending
  // delay timeout) without touching the global timer.
  const cancelCurrentStep = React.useCallback(() => {
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
    if (delayTimeoutRef.current !== null) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = null;
    }
  }, [timer]);

  // ---- Per-frame callback (reads from refs → always uses latest props) ----
  runFrameRef.current = (elapsed: number) => {
    const interpolator = interpolatorRef.current;
    if (!interpolator) return;

    const dur = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = dur ? elapsed / dur : 1;

    if (step >= 1) {
      // Final frame of this queue entry – snap to the exact end value.
      const finalData = interpolator(1);
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
      traverseQueueRef.current();
      return;
    }

    // Interpolate using the latest easing function.
    const eased = easeRef.current(step);
    const interpolated = interpolator(eased);
    currentDataRef.current = interpolated;
    setState({
      data: interpolated,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  // ---- Subscribe a timer step (with optional delay) ----
  startStepRef.current = () => {
    // Capture the current generation so we can detect superseded runs.
    const myRun = runRef.current;

    const callback = (elapsed: number) => {
      if (myRun !== runRef.current || !mountedRef.current) return;
      runFrameRef.current(elapsed);
    };

    const dur = durationRef.current;

    if (delayRef.current) {
      delayTimeoutRef.current = setTimeout(() => {
        delayTimeoutRef.current = null;
        if (myRun !== runRef.current || !mountedRef.current) return;
        loopIDRef.current = timer.subscribe(callback, dur);
      }, delayRef.current);
    } else {
      loopIDRef.current = timer.subscribe(callback, dur);
    }
  };

  // ---- Traverse the queue: start the next step or invoke onEnd ----
  traverseQueueRef.current = () => {
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      // Interpolate from the currently-visible style toward the next target.
      interpolatorRef.current = victoryInterpolator(
        currentDataRef.current,
        nextData,
      );
      startStepRef.current();
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  // ---- Mount: kick off the initial queue (if any) and set up cleanup ----
  React.useEffect(() => {
    mountedRef.current = true;

    // The initial queue was seeded from `data` during the first render.
    if (queueRef.current.length) {
      traverseQueueRef.current();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      // Stop everything so completion / onEnd cannot fire after unmount.
      mountedRef.current = false;
      cancelCurrentStep();
    };
  }, []);

  // ---- Data change: hand off from the current visible style ----
  React.useEffect(() => {
    // On the initial mount (and any StrictMode re-invocation) `data` has not
    // changed since `prevDataRef` was seeded, so skip – the mount effect above
    // already started the initial queue.
    if (prevDataRef.current === data) {
      return;
    }
    prevDataRef.current = data;

    // Cancel the in-progress step (timer + pending delay) so the superseded
    // run cannot render or complete later.
    cancelCurrentStep();
    // Bump the generation so any callback still in-flight knows it is stale.
    runRef.current++;

    // Build the replacement queue from the new data. For an array every entry
    // is a target to animate toward, in order. For a single object we wrap it.
    queueRef.current = Array.isArray(data) ? data.slice() : [data];

    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
