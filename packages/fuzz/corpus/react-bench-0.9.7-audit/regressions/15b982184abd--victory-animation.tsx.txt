// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 15b982184abdd67b7002154393804e56996aa6eeb43e29325e2007a83990cde7
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
  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  const timer = React.useContext(TimerContext).animationTimer;

  // On mount the first array element is the starting style, so only the
  // remaining elements are queued as targets. A single value (or a
  // single-element array) is queued as a target equal to the starting style
  // so that `onEnd` still fires once after the run completes.
  const initialQueue = Array.isArray(data)
    ? data.length > 1
      ? data.slice(1)
      : data
    : [data];
  const queueRef = React.useRef<AnimationStyle[]>(initialQueue);
  // The interpolator for the currently running step.
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  // The active timer subscription id.
  const loopIDRef = React.useRef<number | undefined>(undefined);
  // A pending `delay` timeout that has not yet started its step.
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // The latest value that has been rendered. New steps always start from here so
  // a prop change can continue from the visible style without flashing the
  // superseded target.
  const currentStyleRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  // Mirror the latest animation settings into refs so the per-frame callback -
  // which the timer may hold a stale reference to - always reads the freshest
  // values and an active animation adopts updated props immediately.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);

  // A generation counter. Every replacement increments it; a superseded run
  // whose captured generation no longer matches can neither render nor
  // complete (and therefore cannot fire `onEnd`).
  const runRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const isFirstDataRunRef = React.useRef(true);

  durationRef.current = duration;
  easingRef.current = easing;
  onEndRef.current = onEnd;
  delayRef.current = delay;

  const getEase = () => d3Ease[formatAnimationName(easingRef.current)];

  // The per-frame callback and queue traversal are stored in refs that are
  // reassigned every render. Because they only ever read from refs, even an
  // older instance still held by the timer behaves correctly.
  const perFrameRef = React.useRef<(elapsed: number) => void>(() => {});
  const traverseRef = React.useRef<() => void>(() => {});

  const cancelRun = () => {
    if (delayTimeoutRef.current) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = null;
    }
    if (loopIDRef.current) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  };

  traverseRef.current = () => {
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      // Always tween from the currently visible style.
      interpolatorRef.current = victoryInterpolator(
        currentStyleRef.current,
        nextData,
      );

      const run = runRef.current;
      const subscribe = () => {
        // If this run was superseded or the component unmounted before the
        // delay elapsed, do not start a new subscription.
        if (run !== runRef.current || !mountedRef.current) return;
        loopIDRef.current = timer.subscribe(
          perFrameRef.current,
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayTimeoutRef.current = setTimeout(() => {
          delayTimeoutRef.current = null;
          subscribe();
        }, delayRef.current);
      } else {
        subscribe();
      }
    } else if (onEndRef.current) {
      // Only the active run reaches an empty queue, so only the latest
      // `onEnd` is invoked, and only once.
      onEndRef.current();
    }
  };

  perFrameRef.current = (elapsed: number) => {
    if (!interpolatorRef.current) return;

    const run = runRef.current;
    // Use the latest duration so an active animation adopts prop changes.
    const dur = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1; if this
    // happens complete the step.
    const step = dur ? elapsed / dur : 1;

    if (step >= 1) {
      const finalData = interpolatorRef.current(1);
      currentStyleRef.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopIDRef.current) {
        timer.unsubscribe(loopIDRef.current);
        loopIDRef.current = undefined;
      }
      queueRef.current.shift();
      // Only the active run may move on to the next step / completion.
      if (run === runRef.current && mountedRef.current) {
        traverseRef.current();
      }
      return;
    }

    // If we're not at the end of the timer, set the state by passing the
    // current step value (transformed by the latest ease function) to the
    // interpolator.
    const interpolated = interpolatorRef.current(getEase()(step));
    currentStyleRef.current = interpolated;
    setState({
      data: interpolated,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  // Unmount: stop the active timer and clear any pending delay so completion
  // can never fire after the component is gone.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRun();
      // Allow a StrictMode remount to re-run the mount logic.
      isFirstDataRunRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount and `data` changes.
  React.useEffect(() => {
    if (isFirstDataRunRef.current) {
      // On mount the queue was already initialised from the first array
      // element; just start it.
      isFirstDataRunRef.current = false;
      if (queueRef.current.length) {
        traverseRef.current();
      }
    } else {
      // The previous run is superseded: cancel it and invalidate it so it can
      // neither render nor complete later.
      cancelRun();
      runRef.current += 1;
      // Replace the queue and continue from the currently visible style toward
      // the new data, preserving ordered array-data queues.
      queueRef.current = Array.isArray(data) ? data : [data];
      traverseRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
