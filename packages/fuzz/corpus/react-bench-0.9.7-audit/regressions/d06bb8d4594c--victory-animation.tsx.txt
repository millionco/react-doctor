// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d06bb8d4594c7b9961a7beebe5e9991974faff91f87c92868202a60b7808b635
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

  // Latest prop values are stored in refs so that an animation that is already
  // in progress can adopt updated `duration`, `easing`, `delay`, and `onEnd`
  // without having to restart. The per-frame callback always reads from these
  // refs, which means a run that is partway through will use the most recent
  // settings, and only the latest `onEnd` is invoked when the queue completes.
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  durationRef.current = duration;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  easeRef.current = d3Ease[formatAnimationName(easing)];

  // The ordered queue of styles still left to animate toward. On mount, the
  // first element of an array `data` prop is the initial (already-rendered)
  // state and the remaining elements form the queue; a bare object becomes a
  // single step so that `onEnd` still fires once the run finishes.
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolatorRef = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonic identifier for the active run. Incremented whenever a run is
  // superseded (by a `data` change or unmount) so that callbacks belonging to
  // a cancelled run can detect they are stale and no-op. This guarantees a
  // superseded run can neither render nor complete later.
  const runRef = React.useRef(0);
  // The most recently rendered style. Used as the starting point whenever a
  // new step - or a replacement run triggered by a `data` change - begins, so
  // the animation always continues from the currently visible value.
  const latestDataRef = React.useRef<AnimationStyle>(state.data);
  latestDataRef.current = state.data;

  const mountedRef = React.useRef(false);
  // The last `data` value we acted on, used to detect genuine data changes
  // (by value) so that updating only `duration`/`easing`/`onEnd`/`delay`
  // does not restart an active run.
  const prevDataRef = React.useRef<AnimationData>(data);

  const startStep = (runID: number) => {
    const queue = queueRef.current;

    if (queue.length === 0) {
      // The queue is finished - notify the latest `onEnd` listener.
      const cb = onEndRef.current;
      if (cb) {
        cb();
      }
      return;
    }

    const nextData = queue[0];
    // Always interpolate from the currently visible style so a replacement
    // run never flashes the superseded target value.
    interpolatorRef.current = victoryInterpolator(latestDataRef.current, nextData);

    const stepDuration = durationRef.current;
    const stepDelay = delayRef.current;

    const runFrame = (elapsed: number) => {
      // Ignore frames from a run that has been superseded or unmounted.
      if (runID !== runRef.current || !interpolatorRef.current) {
        return;
      }

      // Adopt the latest `duration` for the progress calculation.
      const currentDuration = durationRef.current;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolatorRef.current(1);
        // Update the visible style before starting the next step so the
        // subsequent interpolation starts from the finished value.
        latestDataRef.current = finalData;
        setState({
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        if (loopIDRef.current != null) {
          timer.unsubscribe(loopIDRef.current);
          loopIDRef.current = undefined;
        }
        queueRef.current = queueRef.current.slice(1);
        // Continue to the next queued step within the same run.
        startStep(runID);
        return;
      }

      // Adopt the latest `easing` for the in-progress step.
      setState({
        data: interpolatorRef.current(easeRef.current(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    // Preserve delayed starts. The pending timeout is tracked so it can be
    // cancelled, and the run id is re-checked after the wait so a stale
    // delayed start cannot subscribe a superseded run.
    if (stepDelay) {
      delayTimeoutRef.current = setTimeout(() => {
        delayTimeoutRef.current = undefined;
        if (runID !== runRef.current) {
          return;
        }
        loopIDRef.current = timer.subscribe(runFrame, stepDuration);
      }, stepDelay);
    } else {
      loopIDRef.current = timer.subscribe(runFrame, stepDuration);
    }
  };

  const cancelCurrentRun = () => {
    // Invalidate any in-flight frame callbacks and pending delayed starts so
    // a superseded run can neither render nor complete later.
    runRef.current += 1;
    if (delayTimeoutRef.current) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopIDRef.current != null) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  };

  // Start the run on mount, or hand off to a replacement run when `data`
  // changes by value. The handoff continues from the currently visible style
  // toward the new data and completes only the replacement run. When only
  // `duration`/`easing`/`onEnd`/`delay` change, the active run is left in
  // place so it can adopt the latest settings via the refs above.
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevDataRef.current = data;
      startStep(runRef.current);
      return;
    }

    // Compare by value so a parent re-rendering with an equivalent `data`
    // object does not restart an in-progress animation.
    if (isEqual(prevDataRef.current, data)) {
      return;
    }

    prevDataRef.current = data;
    // `data` changed mid-run (or while a step was queued): supersede the
    // active run and start fresh from the visible style.
    cancelCurrentRun();
    queueRef.current = Array.isArray(data) ? data : [data];
    startStep(runRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Unmount: stop the active timer and clear any pending delayed start so
  // completion cannot fire after the component is gone. Resetting the mount
  // flag also lets React StrictMode (which simulates an unmount/remount in
  // development) restart the animation on the second mount.
  React.useEffect(() => {
    return () => {
      runRef.current += 1;
      mountedRef.current = false;
      if (delayTimeoutRef.current) {
        clearTimeout(delayTimeoutRef.current);
        delayTimeoutRef.current = undefined;
      }
      if (loopIDRef.current != null) {
        timer.unsubscribe(loopIDRef.current);
        loopIDRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
