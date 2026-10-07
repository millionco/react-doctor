// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 7a8c69f2ab213d3109428bb1065694be98d8f16eac19f33659dc75d03acfb1a6
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

  // --- Mutable refs for animation bookkeeping ---
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayedTimerID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const mountedRef = React.useRef(true);

  // --- Refs mirroring the latest props so a running animation always
  //     adopts the newest duration / easing / delay / onEnd values ---
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  // --- Ref mirroring the latest visible style so a handoff can continue
  //     from the currently displayed value without flashing the old target ---
  const stateDataRef = React.useRef(state.data);

  // Keep refs in sync on every render.
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  stateDataRef.current = state.data;

  // Cancel any active timer subscription **and** any pending delayed start.
  const cancelActiveRun = React.useCallback(() => {
    if (delayedTimerID.current !== undefined) {
      clearTimeout(delayedTimerID.current);
      delayedTimerID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  // The per-frame callback is created once and reads exclusively from refs,
  // so it always uses the latest duration / easing / state without needing to
  // be resubscribed.
  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current || !mountedRef.current) return;

      const currentDuration = durationRef.current;
      const ease = d3Ease[formatAnimationName(easingRef.current)];
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        setState({
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

      setState({
        data: interpolator.current(ease(step)),
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer],
  );

  // traverseQueue is stored in a ref so that functionToBeRunEachFrame (which
  // is stable via useCallback) can always invoke the latest version.
  const traverseQueueRef = React.useRef<() => void>(() => {});

  traverseQueueRef.current = () => {
    if (!mountedRef.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Continue from the currently visible style so there is no flash of
      // the superseded target.
      interpolator.current = victoryInterpolator(stateDataRef.current, nextData);

      const currentDuration = durationRef.current;
      const currentDelay = delayRef.current;

      if (currentDelay) {
        delayedTimerID.current = setTimeout(() => {
          delayedTimerID.current = undefined;
          if (!mountedRef.current) return;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            currentDuration,
          );
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      }
    } else if (onEndRef.current) {
      // Only the latest onEnd is invoked when the queue drains.
      onEndRef.current();
    }
  };

  // Track whether we are past the first render so the [data] effect can
  // skip the initial mount (handled by the mount effect below).
  const isFirstRender = React.useRef(true);

  // --- Mount: set up the initial queue for array data and start it.
  //     Non-array data is already represented by the initial state, so no
  //     animation is started on mount. ---
  React.useEffect(() => {
    mountedRef.current = true;

    if (Array.isArray(data)) {
      queue.current = data.slice(1);
    } else {
      queue.current = [];
    }

    if (queue.current.length) {
      traverseQueueRef.current();
    }

    return () => {
      // Unmounting must stop the active timer (and any pending delayed
      // start) so completion cannot fire afterward.
      mountedRef.current = false;
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Data change: cancel any in-progress animation, then start a fresh
  //     run from the currently visible style toward the new data. ---
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return; // mount is handled by the effect above
    }

    // A superseded run must not render or complete later.
    cancelActiveRun();

    // Build the replacement queue.  For array data every element is a
    // step; for a single object the queue contains just that one target.
    queue.current = Array.isArray(data) ? data.slice() : [data];

    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
