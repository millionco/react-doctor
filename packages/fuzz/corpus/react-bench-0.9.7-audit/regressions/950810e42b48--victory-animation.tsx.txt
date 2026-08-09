// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 950810e42b48e92dd99d7cbe0d53c799767891a920157e4431152d8715599802
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

  // Refs that always hold the latest props/state so a running animation can
  // adopt the newest duration/easing/onEnd/delay without re-subscribing, and
  // so a data change can hand off from the value currently on screen.
  const timerRef = React.useRef(timer);
  timerRef.current = timer;

  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };

  // The most recently rendered (visible) style. This is the start value for
  // any new interpolation so we never flash a superseded target.
  const visibleDataRef = React.useRef<AnimationStyle>(state.data);
  visibleDataRef.current = state.data;

  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonic run token. Each fresh run increments it; superseded runs bail
  // out of their scheduled callbacks so they can't render or complete later.
  const runTokenRef = React.useRef(0);
  // Skip the data effect on the initial mount (handled by the mount effect).
  const isFirstDataEffectRef = React.useRef(true);

  // Stop whatever run is currently active: invalidate it (via the run token),
  // clear any pending delayed start, and unsubscribe the active timer loop.
  const stopActiveRun = React.useCallback(() => {
    runTokenRef.current += 1;
    if (delayTimerRef.current !== undefined) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timerRef.current.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, []);

  const traverseQueue = React.useCallback(() => {
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolatorRef.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      // Capture the token for this run so a delayed start that has been
      // superseded can bail out before subscribing.
      const token = runTokenRef.current;
      const beginStep = () => {
        if (token !== runTokenRef.current) {
          return;
        }
        loopIDRef.current = timerRef.current.subscribe(
          runFrame,
          propsRef.current.duration,
        );
      };

      if (propsRef.current.delay) {
        delayTimerRef.current = setTimeout(beginStep, propsRef.current.delay);
      } else {
        beginStep();
      }
    } else {
      // Queue drained: invoke only the latest onEnd callback.
      const { onEnd: latestOnEnd } = propsRef.current;
      if (latestOnEnd) {
        latestOnEnd();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFrame = React.useCallback((elapsed: number) => {
    if (!interpolatorRef.current) {
      return;
    }

    // Read the latest duration/easing so an active animation adopts any
    // mid-run prop changes.
    const { duration: currentDuration, easing: currentEasing } =
      propsRef.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolatorRef.current(1);
      // Record the end of this step as the hand-off point for the next one.
      visibleDataRef.current = finalData;
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
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const interpolated = interpolatorRef.current(ease(step));
    visibleDataRef.current = interpolated;
    setState({
      data: interpolated,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traverseQueue]);

  // Initial mount setup. The initial state already reflects data[0] (array) or
  // data (single); only kick off the queued steps.
  React.useEffect(() => {
    if (queueRef.current.length) {
      traverseQueue();
    }
    // Unmount: stop the active timer/subscription and any pending delayed
    // start so completion cannot fire afterward.
    return () => {
      stopActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to data changes (skipping the first run, handled above).
  React.useEffect(() => {
    if (isFirstDataEffectRef.current) {
      isFirstDataEffectRef.current = false;
      return;
    }
    // Stop the in-progress run and invalidate it so it can neither render nor
    // complete later. Then continue from the currently visible style toward
    // the new data (no flash to the superseded target).
    stopActiveRun();
    queueRef.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
