// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit ac76d59804d679a8b2288c208b027ee7795d941628e8c779b37d80cfadefe6d6
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

type Interpolator = (value: number) => AnimationStyle;

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

  // ---- Runtime refs -------------------------------------------------------
  // The ordered queue of styles that still need to be animated toward.
  const queueRef = React.useRef<AnimationStyle[]>([]);
  // The active interpolator for the current step.
  const interpolatorRef = React.useRef<Interpolator | null>(null);
  // The active timer subscription id (if any).
  const loopIDRef = React.useRef<number | undefined>(undefined);
  // A pending delayed-start timeout (if any).
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonically increasing id for the current "run". Any callback created
  // for an older run is considered superseded and becomes a no-op, so a stale
  // timer/timeout can never render or complete a superseded animation.
  const runIDRef = React.useRef(0);
  // Whether the initial mount has been handled, and the last `data` we built a
  // queue from (compared by value so semantically-identical data doesn't reset
  // an in-progress run).
  const mountedRef = React.useRef(false);
  const prevDataRef = React.useRef<AnimationData | undefined>(undefined);

  // ---- Latest-prop refs ---------------------------------------------------
  // Active animations read these so they always adopt the newest `duration`,
  // `easing`, `delay`, and `onEnd` rather than the values captured when the
  // run started.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  // Mirror of the currently-visible style. Updated on every render and
  // synchronously whenever we produce a new interpolated value, so that
  // handoffs start from exactly what is on screen.
  const dataRef = React.useRef<AnimationStyle>(state.data);

  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;
  dataRef.current = state.data;

  // Used to break the mutual recursion between `runFrame` and `traverseQueue`.
  const advanceRef = React.useRef<() => void>(() => {});

  // Cancel whatever animation is currently in flight (active subscription or
  // pending delayed start) and invalidate every callback associated with it.
  const cancelActiveRun = () => {
    runIDRef.current += 1;
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
  };

  // Per-frame callback. `runID` is the run this frame belongs to; if the run
  // has been superseded we do nothing.
  const runFrame = (elapsed: number, runID: number) => {
    if (runID !== runIDRef.current || !interpolatorRef.current) {
      return;
    }

    const activeDuration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1; if this
    // happens, snap to the end and finish the step.
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      const finalData = interpolatorRef.current(1);
      dataRef.current = finalData;
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
      advanceRef.current();
      return;
    }

    // If we're not at the end of the timer, set the state by passing the
    // current step value (transformed by the latest ease function) to the
    // cached interpolator.
    const interpolated = interpolatorRef.current(easeRef.current(step));
    dataRef.current = interpolated;
    setState({
      data: interpolated,
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  // Begin (or continue) animating through the queue. `runID` ties the work to
  // a specific run so superseded runs short-circuit.
  const traverseQueue = (runID: number) => {
    if (runID !== runIDRef.current) {
      return;
    }

    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      // Always interpolate from the currently-visible style so handoffs never
      // flash a superseded target.
      interpolatorRef.current = victoryInterpolator(dataRef.current, nextData);

      const begin = () => {
        // The delayed start may have been superseded while waiting.
        if (runID !== runIDRef.current) {
          return;
        }
        loopIDRef.current = timer.subscribe(
          (elapsed: number) => runFrame(elapsed, runID),
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayTimeoutRef.current = setTimeout(() => {
          delayTimeoutRef.current = undefined;
          begin();
        }, delayRef.current);
      } else {
        begin();
      }
    } else {
      // The queue is exhausted: notify via the latest `onEnd` only.
      const latestOnEnd = onEndRef.current;
      if (latestOnEnd) {
        latestOnEnd();
      }
    }
  };

  advanceRef.current = () => traverseQueue(runIDRef.current);

  // ---- Effects ------------------------------------------------------------
  // Initial mount: seed the ordered queue from `data` (the first array element
  // is the starting style; everything after it is animated through, and a
  // single datum animates as a no-op so `onEnd` still fires) and start it. The
  // cleanup tears down whatever run is in flight so completion can't fire
  // after unmount (and so StrictMode's mount -> cleanup -> remount cycle
  // re-creates the run instead of leaving a stale one).
  React.useEffect(() => {
    queueRef.current = Array.isArray(data) ? data.slice(1) : [data];
    if (queueRef.current.length) {
      traverseQueue(runIDRef.current);
    }
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subsequent `data` changes: hand off from the currently-visible style
  // toward the new data, replacing the in-flight run entirely. Semantically
  // identical data (e.g. a parent re-rendering with a fresh object) does not
  // reset the run; only `duration`/`easing`/`delay`/`onEnd` may have changed,
  // and the active run reads those from refs.
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevDataRef.current = data;
      return;
    }
    if (isEqual(prevDataRef.current, data)) {
      prevDataRef.current = data;
      return;
    }
    prevDataRef.current = data;
    cancelActiveRun();
    queueRef.current = Array.isArray(data) ? data.slice() : [data];
    if (queueRef.current.length) {
      traverseQueue(runIDRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
