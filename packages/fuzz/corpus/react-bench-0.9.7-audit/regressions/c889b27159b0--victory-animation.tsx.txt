// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c889b27159b0688bb2e7df9ad8e29f92f7575081f6c361a779ed11911713ce67
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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

  // Refs that always hold the latest prop values. The animation loop reads
  // from these so an in-progress run adopts new `duration`, `easing`, and
  // `onEnd` without needing to be torn down and restarted.
  const timerRef = React.useRef(timer);
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  // The ordered queue of styles still to be interpolated, the active
  // interpolator, the active timer subscription id, and any pending delay
  // timeout. These live in refs so the stable loop/effect callbacks can mutate
  // them without capturing stale closures.
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

  // Mirror of the style currently rendered to the screen. Used as the start
  // point whenever a new interpolation begins so we can hand off from the
  // currently visible style instead of flashing a superseded target.
  const currentDataRef = React.useRef<AnimationStyle>(state.data);

  // The previous `data` prop (by value) so the data effect only reacts when the
  // data actually changes, letting pure `duration`/`easing`/`onEnd` changes be
  // adopted by the active run.
  const prevDataRef = React.useRef<AnimationData>(data);

  // Keep every prop ref in sync on each render.
  timerRef.current = timer;
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // `traverseQueue` is referenced by `onFrame`; break the cycle with a ref.
  const traverseQueueRef = React.useRef<() => void>(() => {});

  // Tear down whatever run is currently active (a pending delayed start and/or
  // an in-flight subscription) so a superseded run can never render or complete
  // later.
  const cancelActiveRun = React.useCallback(() => {
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timerRef.current.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, []);

  // Per-frame callback. Stable (only depends on `traverseQueue`), and reads
  // every dynamic value from a ref, so the timer can keep calling this same
  // function while always using the latest `duration` and `easing`.
  const onFrame = React.useCallback(
    (elapsed: number) => {
      const interpolator = interpolatorRef.current;
      if (!interpolator) return;

      const dur = durationRef.current;
      // Step can generate imprecise values, sometimes greater than 1.
      const step = dur ? elapsed / dur : 1;

      if (step >= 1) {
        // Finish the current step at its requested final style.
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
          timerRef.current.unsubscribe(loopIDRef.current);
          loopIDRef.current = undefined;
        }
        queueRef.current.shift();
        traverseQueueRef.current();
        return;
      }

      const eased = easeRef.current(step);
      const interpolated = interpolator(eased);
      currentDataRef.current = interpolated;
      setState({
        data: interpolated,
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    },
    [],
  );

  // Begin the next queued interpolation (or fire `onEnd` when the queue is
  // empty). Stable: reads everything from refs.
  const traverseQueue = React.useCallback(() => {
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      // Always interpolate from the style currently visible on screen.
      interpolatorRef.current = victoryInterpolator(currentDataRef.current, nextData);

      const start = () => {
        loopIDRef.current = timerRef.current.subscribe(
          onFrame,
          durationRef.current,
        );
      };

      // Preserve delayed starts.
      if (delayRef.current) {
        delayTimeoutRef.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  }, [onFrame]);

  traverseQueueRef.current = traverseQueue;

  // Start the initial queue on mount. This effect has no reactive deps, so it
  // only runs on mount (and re-runs after the dev-only StrictMode unmount/remount
  // cycle). The cleanup cancels any active run, which also covers unmounting:
  // the active timer/timeout is stopped so completion cannot fire afterward.
  React.useEffect(() => {
    cancelActiveRun();
    if (queueRef.current.length) {
      traverseQueue();
    }
    return () => {
      cancelActiveRun();
    };
  }, [cancelActiveRun, traverseQueue]);

  // React to `data` changes only. On mount `prevDataRef` already equals `data`,
  // so this effect no-ops while the mount effect above starts the initial queue.
  // When only `duration`/`easing`/`onEnd` change, `isEqual` is true and the
  // active run adopts the new values via refs. When `data` actually changes, we
  // hand off from the currently visible style toward the new data without
  // completing (or flashing) the superseded run.
  React.useEffect(() => {
    if (isEqual(prevDataRef.current, data)) {
      prevDataRef.current = data;
      return;
    }
    prevDataRef.current = data;

    cancelActiveRun();
    queueRef.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
