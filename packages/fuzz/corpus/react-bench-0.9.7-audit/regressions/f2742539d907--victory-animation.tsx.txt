// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit f2742539d90791d26c1a8bb9aeaaee8a37700bf3bdcbfc9cfcef5a678e63cf97
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

  // Refs that always point to the latest prop values so that the per-frame
  // callback (which is subscribed once and reused for the lifetime of a step)
  // and the completion logic always adopt the most recent settings, even when
  // `duration`, `easing`, `delay`, or `onEnd` change mid-run.
  const timerRef = React.useRef(timer);
  timerRef.current = timer;
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easingRef = React.useRef(easing);
  easingRef.current = easing;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  // Mutable animation state. `visibleRef` mirrors the most recently rendered
  // style so that handoffs always continue from the currently visible value
  // instead of a stale or superseded target.
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const visibleRef = React.useRef<AnimationStyle>(state.data);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const mountedRef = React.useRef(true);

  // `startStep` is referenced by `step` (via the completion path) before it is
  // defined, so we stash it in a ref that is populated after declaration.
  const startStepRef = React.useRef<() => void>(() => {});

  // Cancel whatever run is currently active: clear a pending delayed start and
  // unsubscribe the per-frame loop. This guarantees a superseded run can never
  // render or complete later.
  const cancelCurrentRun = React.useCallback(() => {
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timerRef.current.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, []);

  // Per-frame callback. Subscribed once per step and reused; it reads only from
  // refs so it always uses the latest `duration` and `easing`.
  const step = React.useCallback((elapsed: number) => {
    if (!mountedRef.current || !interpolatorRef.current) {
      return;
    }

    const activeDuration = durationRef.current;
    const progress = activeDuration ? elapsed / activeDuration : 1;

    if (progress >= 1) {
      // This step is finished: settle on the final value, drop this step from
      // the queue, and move on to the next one (or fire `onEnd`).
      const finalStyle = interpolatorRef.current(1);
      visibleRef.current = finalStyle;
      setState({
        data: finalStyle,
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
      startStepRef.current();
      return;
    }

    const eased = d3Ease[formatAnimationName(easingRef.current)](progress);
    const style = interpolatorRef.current(eased);
    visibleRef.current = style;
    setState({
      data: style,
      animationInfo: {
        progress,
        animating: true,
      },
    });
  }, []);

  // Begin animating toward the head of the queue (from the currently visible
  // style), or, if the queue is empty, finalize and invoke `onEnd`.
  const startStep = React.useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (queueRef.current.length === 0) {
      // The queue is complete. If nothing ever animated (e.g. a single-element
      // data array on mount), render the terminal state; otherwise the
      // completing step already did. Then fire the latest `onEnd` exactly once.
      if (!interpolatorRef.current) {
        setState({
          data: visibleRef.current,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
      }
      onEndRef.current?.();
      return;
    }

    const nextData = queueRef.current[0];
    interpolatorRef.current = victoryInterpolator(visibleRef.current, nextData);

    const activeDuration = durationRef.current;
    const begin = () => {
      if (!mountedRef.current) {
        return;
      }
      loopIDRef.current = timerRef.current.subscribe(step, activeDuration);
    };

    if (delayRef.current) {
      delayTimeoutRef.current = setTimeout(() => {
        delayTimeoutRef.current = undefined;
        begin();
      }, delayRef.current);
    } else {
      begin();
    }
  }, [step]);

  startStepRef.current = startStep;

  // Start the initial run once on mount and tear it down on unmount. Unmount
  // stops the active timer/subscription and clears any pending delayed start so
  // that completion (and `onEnd`) can never fire afterward.
  React.useEffect(() => {
    mountedRef.current = true;
    startStep();
    return () => {
      mountedRef.current = false;
      cancelCurrentRun();
    };
  }, [startStep, cancelCurrentRun]);

  // When `data` changes, hand off from the currently visible style to the new
  // data without flashing any superseded target. The previous run is fully
  // cancelled first so it cannot render or complete later. The initial run is
  // handled by the mount effect above, so this effect only acts on an actual
  // change of `data` (by reference). Comparing to the previously seen value
  // also keeps this idempotent under React StrictMode double-invocation.
  const prevDataRef = React.useRef(data);
  React.useEffect(() => {
    const prev = prevDataRef.current;
    prevDataRef.current = data;
    if (prev === data) {
      return;
    }
    cancelCurrentRun();
    queueRef.current = Array.isArray(data) ? data.slice() : [data];
    startStep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
