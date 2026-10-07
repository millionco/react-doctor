// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2b17b3812f8a9510060e6ce1f81b19e077ff08a1d3580e4afe92f1b58af91505
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

  // Track the current run so superseded runs can be detected and ignored.
  const runIDRef = React.useRef(0);

  // Track the latest visible data so new interpolations start from the
  // currently visible style rather than from a stale or superseded target.
  const currentDataRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  // Refs that always hold the latest prop values so callbacks passed to the
  // timer (which capture a single function reference) read current settings.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // A ref that always points to the latest per-frame implementation.  The
  // timer stores a single stable wrapper; this indirection lets us update
  // the real callback every render without re-subscribing.
  const frameImplRef = React.useRef<
    (elapsed: number, frameDuration: number) => void
  >(() => {});

  // The stable wrapper the timer calls.  It delegates to frameImplRef so the
  // latest implementation (with the latest closures/props) is always used.
  const stableFrameCallback = React.useCallback(
    (elapsed: number, frameDuration: number) => {
      frameImplRef.current(elapsed, frameDuration);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Cancel any active timer subscription and pending delayed-start timeout. */
  const cancelLoop = React.useCallback(() => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  /**
   * Begin (or restart) the animation for the next item in the queue.  The
   * interpolation always starts from the *currently visible* data so there is
   * no flash of a superseded target.  A new run ID is assigned so that any
   * timer callback from a previous run can detect it is stale and bail out.
   */
  const traverseQueue = React.useCallback(() => {
    // Increment the run ID so stale callbacks from previous runs are ignored.
    runIDRef.current++;

    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(
        currentDataRef.current,
        nextData,
      );

      const localRunID = runIDRef.current;

      const startSubscription = () => {
        // If a newer run has started, don't subscribe.
        if (runIDRef.current !== localRunID) return;
        loopID.current = timer.subscribe(
          stableFrameCallback,
          durationRef.current,
        );
      };

      if (delayRef.current) {
        timeoutID.current = setTimeout(() => {
          // If a newer run has started (or unmounted), don't subscribe.
          if (runIDRef.current !== localRunID) return;
          startSubscription();
        }, delayRef.current);
      } else {
        startSubscription();
      }
    } else {
      // Queue is empty — the animation sequence is complete.  Invoke only
      // the latest onEnd callback.
      const latestOnEnd = onEndRef.current;
      if (latestOnEnd) {
        latestOnEnd();
      }
    }
  }, [timer, stableFrameCallback]);

  /**
   * Per-frame callback.  This is reassigned every render so it always closes
   * over the latest props.  The timer only ever calls stableFrameCallback,
   * which delegates here.
   */
  frameImplRef.current = (elapsed: number, frameDuration: number) => {
    if (!interpolator.current) return;

    const step = frameDuration ? elapsed / frameDuration : 1;

    if (step >= 1) {
      // This step has completed.  Render the final interpolated value and
      // start the next queued step (if any).
      const finalData = interpolator.current(1);
      currentDataRef.current = finalData;
      setState({
        data: finalData,
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
      traverseQueue();
      return;
    }

    // Render the interpolated data at the current eased step.
    const ease = d3Ease[formatAnimationName(easingRef.current)];
    const interpolated = interpolator.current(ease(step));
    currentDataRef.current = interpolated;
    setState({
      data: interpolated,
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Mount: start the initial queue (if any).  Unmount: cancel everything.
  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }

    return () => {
      cancelLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When `data` changes, cancel any in-progress run and start a new
  // interpolation from the currently visible style toward the new data.
  // The old target is never rendered, and only the replacement run completes.
  const dataRef = React.useRef(data);
  React.useEffect(() => {
    if (dataRef.current === data) return; // no change (e.g. initial mount)
    dataRef.current = data;

    cancelLoop();
    // Build a fresh queue from the new data.  When data is an array every
    // element is an ordered animation target (the initial starting value was
    // only consumed on mount).  For a single (non-array) value the value
    // itself is the sole target.
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // When `duration` or `easing` changes during an active animation, restart
  // the current step from the currently visible position so the remaining
  // interpolation uses the new settings.  `onEnd` and `delay` are read from
  // refs at call-time, so they don't need a dedicated effect.
  const durationEasingRef = React.useRef({ duration, easing });
  React.useEffect(() => {
    const prev = durationEasingRef.current;
    if (prev.duration === duration && prev.easing === easing) return;
    durationEasingRef.current = { duration, easing };

    // Only restart if an animation is actually in progress.  traverseQueue
    // will build a fresh interpolator from the currently visible position to
    // the current queue target, so the animation continues smoothly with the
    // new settings.
    if (
      interpolator.current &&
      loopID.current !== undefined &&
      state.animationInfo.progress < 1
    ) {
      cancelLoop();
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, easing]);

  return children(state.data, state.animationInfo);
};
