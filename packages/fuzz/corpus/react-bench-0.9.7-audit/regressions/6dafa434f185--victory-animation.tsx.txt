// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6dafa434f185ede06d10ecd3b00098354d7a325ee7c2cd35f95ee0d4c392d5c1
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

  // --- Refs that always hold the latest prop values so that long-running
  // callbacks (started by a previous render) adopt the newest settings ---
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // --- Animation internals ---
  // The queue of styles still to be animated towards.
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  // Cached interpolator for the current step.
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  // Active timer subscription id (if any).
  const loopIDRef = React.useRef<number | undefined>(undefined);
  // Pending setTimeout handle for a delayed start (if any).
  const timeoutIDRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonic run id.  Incrementing it invalidates every callback / timer
  // belonging to the previous run so that a superseded run can never render
  // or complete later.
  const runIDRef = React.useRef(0);
  // The most recently rendered (or about-to-be-rendered) style.  This is used
  // as the "from" value when starting a new step so that we always continue
  // from the currently visible style.
  const stateDataRef = React.useRef<AnimationStyle>(state.data);
  stateDataRef.current = state.data;
  // Whether the component has already mounted (used to distinguish the
  // initial mount from subsequent `data` changes inside the [data] effect).
  const mountedRef = React.useRef(false);

  /** Resolve the easing function from the latest `easing` prop. */
  const getEase = () =>
    d3Ease[formatAnimationName(easingRef.current as AnimationEasing)];

  /** Cancel the active animation, invalidating every pending callback. */
  const cancelAnimation = () => {
    runIDRef.current++;
    if (loopIDRef.current !== undefined) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
    if (timeoutIDRef.current !== undefined) {
      clearTimeout(timeoutIDRef.current);
      timeoutIDRef.current = undefined;
    }
  };

  /**
   * Start the next step in the queue (or fire `onEnd` when the queue is
   * empty).  Each step captures the *latest* `duration`, `easing` and `delay`
   * via the refs above.
   */
  const traverseQueue = () => {
    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      interpolatorRef.current = victoryInterpolator(
        stateDataRef.current,
        nextData,
      );

      const currentDuration = durationRef.current;
      const currentDelay = delayRef.current;
      const easeFn = getEase();
      const runID = runIDRef.current;

      const stepCallback = (elapsed: number) => {
        // Bail out immediately if this run has been superseded.
        if (runID !== runIDRef.current) return;
        if (!interpolatorRef.current) return;

        // Step can generate imprecise values, sometimes greater than 1
        // if this happens set the state to 1 and return, cancelling the timer
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalData = interpolatorRef.current(1);
          // Update the "from" ref immediately so the recursive traverseQueue
          // below starts the next step from the correct value.
          stateDataRef.current = finalData;
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
          traverseQueue();
          return;
        }

        // If we're not at the end of the timer, set the state by passing
        // current step value that's transformed by the ease function to the
        // interpolator, which is cached for performance whenever props are
        // received
        const interpolatedData = interpolatorRef.current(easeFn(step));
        // Keep the ref in sync so a data change mid-step continues from the
        // currently visible style.
        stateDataRef.current = interpolatedData;
        setState({
          data: interpolatedData,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      };

      if (currentDelay) {
        timeoutIDRef.current = setTimeout(() => {
          timeoutIDRef.current = undefined;
          // Bail out if the run was superseded while waiting for the delay.
          if (runID !== runIDRef.current) return;
          loopIDRef.current = timer.subscribe(stepCallback, currentDuration);
        }, currentDelay);
      } else {
        loopIDRef.current = timer.subscribe(stepCallback, currentDuration);
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  // Single effect that handles both the initial mount and subsequent `data`
  // changes.  The cleanup cancels the active animation (on unmount or right
  // before a data-change re-run) so that a superseded run can never fire
  // later.
  React.useEffect(() => {
    if (!mountedRef.current) {
      // --- Mount ---
      mountedRef.current = true;
      if (queueRef.current.length) {
        traverseQueue();
      }
    } else {
      // --- `data` changed ---
      // The cleanup below already cancelled the previous animation and
      // incremented the run id, so we only need to build the new queue and
      // start the replacement run from the currently visible style.
      queueRef.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }

    return () => {
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
