// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 4c057cb1fc09ad76d21fcbbfe084b3caacf534744882299eeafa768f79eb6c89
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
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Tracks the most recently rendered data so that a new interpolation
  // segment can always start from the *currently visible* style rather than
  // from a stale closure value or a superseded target.
  const currentDataRef = React.useRef<AnimationStyle>(state.data);
  // Prevents any post-unmount timer / onEnd from firing.
  const mountedRef = React.useRef(true);
  // Skips the data-change effect on the initial mount (the mount effect
  // handles the first run).
  const firstRunRef = React.useRef(true);
  // Remembers the data that was last consumed so we can deep-compare and
  // avoid restarting the animation when only `duration`, `easing`, or
  // `onEnd` changed.
  const prevDataRef = React.useRef<AnimationData>(data);

  // Refs that always hold the latest prop values.  The per-frame callback and
  // queue traversal are subscribed to the timer once, but because they read
  // from these refs (rather than from closed-over props), an in-progress
  // animation always adopts the latest `duration`, `easing`, and `onEnd`.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);

  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;
  delayRef.current = delay;

  // Keep `traverseQueue` and the per-frame step in refs so that the timer —
  // which holds a reference to the function instance that was subscribed —
  // always calls the *latest* implementation (which in turn reads from the
  // refs above).
  const traverseQueueRef = React.useRef<() => void>(() => {});
  const stepRef = React.useRef<(elapsed: number) => void>(() => {});

  // Update both the ref (synchronous, used by interpolation logic) and React
  // state (drives re-render) together so that a new segment always starts
  // from the value the user is currently seeing.
  const updateState = React.useCallback(
    (newData: AnimationStyle, info: AnimationInfo) => {
      currentDataRef.current = newData;
      setState({ data: newData, animationInfo: info });
    },
    [],
  );

  // Cancel any active timer subscription **and** pending delayed start.
  const cancelTimer = React.useCallback(() => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Always interpolate from the currently visible style so that a
      // superseded run never flashes its old target.
      interpolator.current = victoryInterpolator(
        currentDataRef.current,
        nextData,
      );

      if (delayRef.current) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          if (!mountedRef.current) return;
          loopID.current = timer.subscribe(
            stepRef.current,
            durationRef.current,
          );
        }, delayRef.current);
      } else {
        loopID.current = timer.subscribe(
          stepRef.current,
          durationRef.current,
        );
      }
    } else if (onEndRef.current) {
      // Queue exhausted — invoke only the latest onEnd.
      onEndRef.current();
    }
  };

  stepRef.current = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      updateState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
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
    updateState(interpolator.current(easeRef.current(step)), {
      progress: step,
      animating: true,
    });
  };

  // --- Mount -------------------------------------------------------------
  React.useEffect(() => {
    mountedRef.current = true;
    // For array data, the first element is the starting style and the
    // remainder form the animation queue.  For single-object data there is
    // nothing to animate on mount.
    queue.current = Array.isArray(data) ? data.slice(1) : [];
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    return () => {
      mountedRef.current = false;
      cancelTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Data changes ------------------------------------------------------
  React.useEffect(() => {
    // The mount effect handles the initial run; skip here to avoid starting
    // a redundant animation from data[0] → data[0].
    if (firstRunRef.current) {
      firstRunRef.current = false;
      prevDataRef.current = data;
      return;
    }

    // If the data is deeply equal to what we already consumed, only
    // `duration`, `easing`, or `onEnd` changed.  The refs above already
    // adopted the latest values, so the in-progress animation continues
    // uninterrupted and will invoke the latest `onEnd` when it completes.
    if (isEqual(prevDataRef.current, data)) {
      return;
    }
    prevDataRef.current = data;

    // Cancel any in-progress or pending step so a superseded run can neither
    // render nor complete later.
    cancelTimer();
    interpolator.current = null;

    // Build a fresh queue from the new data.  An array is traversed in order;
    // a single object becomes a one-element queue.
    queue.current = Array.isArray(data) ? data : [data];

    // Start from the currently visible style toward the new data.
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
