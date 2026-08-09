// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d15a94885014a7ef4a31fcbf23d5defb7141e0b4fb02a2b32d60dc3af5da64cf
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

  // Mutable animation bookkeeping kept in refs so that timer callbacks (which
  // outlive any single render) always operate on the latest values.
  const queueRef = React.useRef<AnimationStyle[]>([]);
  const interpolatorRef = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // A monotonically increasing token. Each run captures the token that was
  // current when it started; if the token no longer matches, the run has been
  // superseded and must not render or complete later.
  const runTokenRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const initializedRef = React.useRef(false);

  // Latest prop values, read by timer callbacks so an in-progress animation
  // always adopts the most recent `duration`, `easing`, `delay`, and `onEnd`.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  easeRef.current = d3Ease[formatAnimationName(easing)];
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  // The most recently rendered (visible) data. Used as the starting point when
  // `data` changes mid-run so we hand off from the current style instead of
  // flashing the superseded target.
  const visibleDataRef = React.useRef<AnimationStyle>(state.data);

  const clearCurrentTimer = () => {
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  };

  const runFrame = (elapsed: number, token: number) => {
    // A superseded run (or one whose component unmounted) must bail out before
    // rendering or completing.
    if (token !== runTokenRef.current || !mountedRef.current) {
      return;
    }
    if (!interpolatorRef.current) {
      return;
    }

    const dur = durationRef.current;
    const ease = easeRef.current;
    // Step can generate imprecise values, sometimes greater than 1; if this
    // happens the step is clamped to 1 and the run completes.
    const step = dur ? elapsed / dur : 1;

    if (step >= 1) {
      const finalData = interpolatorRef.current(1);
      // Re-check the token after computing the final value; a handoff may have
      // happened synchronously and this run must not render or complete.
      if (token !== runTokenRef.current) {
        return;
      }
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
        timer.unsubscribe(loopIDRef.current);
        loopIDRef.current = undefined;
      }
      queueRef.current.shift();
      // Continue the queue from the value we just landed on.
      beginStep(finalData);
      return;
    }

    // If we're not at the end of the timer, set the state by passing the
    // current step value (transformed by the ease function) to the
    // interpolator.
    const currentData = interpolatorRef.current(ease(step));
    visibleDataRef.current = currentData;
    setState({
      data: currentData,
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  const beginStep = (fromData: AnimationStyle) => {
    const queue = queueRef.current;
    if (!queue.length) {
      // The queue is complete; invoke the latest `onEnd` once.
      if (mountedRef.current && onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queue[0];
    interpolatorRef.current = victoryInterpolator(fromData, nextData);

    // Start a new run with a fresh token, invalidating any in-flight callbacks
    // from superseded runs.
    const token = ++runTokenRef.current;

    const startLoop = () => {
      if (token !== runTokenRef.current || !mountedRef.current) {
        return;
      }
      loopIDRef.current = timer.subscribe(
        (elapsed: number) => runFrame(elapsed, token),
        durationRef.current,
      );
    };

    const stepDelay = delayRef.current;
    if (stepDelay) {
      delayTimeoutRef.current = setTimeout(startLoop, stepDelay);
    } else {
      startLoop();
    }
  };

  // Unmount cleanup: stop the active timer (and any delayed start) so that
  // completion cannot fire after the component is gone.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current++;
      clearCurrentTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount + data-change handoff. This runs once on mount and again whenever
  // `data` changes.
  React.useEffect(() => {
    // Cancel whatever run is currently in flight (active subscription and any
    // pending delayed start) and invalidate its callbacks so it cannot render
    // or complete later.
    clearCurrentTimer();
    runTokenRef.current++;

    if (!initializedRef.current) {
      // First run (mount): the initial state already reflects the starting
      // style. For array data the remainder of the array is the queue; for a
      // single value we still run a (no-op) step so `onEnd` fires as before.
      queueRef.current = Array.isArray(data) ? data.slice(1) : [data];
      initializedRef.current = true;
    } else {
      // `data` changed mid-run: hand off from the currently visible style
      // toward the new data without flashing the superseded target.
      queueRef.current = Array.isArray(data) ? data.slice() : [data];
    }

    beginStep(visibleDataRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
