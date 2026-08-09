// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c033e6a0f0944f7e517b5b978de2a37512331b12b280e52d332714eeb6eac740
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

  // Keep the latest animation settings in refs so a run that is already in
  // flight reads the newest values on its next frame instead of the ones that
  // were current when it started. This is what lets an active animation adopt
  // updated `duration`, `easing`, and `onEnd` props.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;
  delayRef.current = delay;

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Identifies the currently active run. Bumping it supersedes any frame
  // callback or delayed start still tied to an older run so that a replaced
  // animation can neither render nor complete after the hand-off.
  const runID = React.useRef(0);
  // The most recently rendered style. A new run continues from here so it picks
  // up wherever the previous animation was visibly left off, without ever
  // flashing the superseded target value.
  const visibleData = React.useRef(state.data);

  const stopActiveTimer = () => {
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    timerDuration: number,
    thisRunID: number,
  ) => {
    // A superseded run must neither render nor complete.
    if (thisRunID !== runID.current || !interpolator.current) {
      return;
    }

    // `timerDuration` is coerced to `0` by the timer when animation is bypassed;
    // in every other case we divide by the latest `duration` prop so an
    // in-progress animation honors updated timing.
    const currentDuration = durationRef.current;
    const step =
      timerDuration && currentDuration ? elapsed / currentDuration : 1;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    if (step >= 1) {
      const finalData = interpolator.current(1);
      visibleData.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(thisRunID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const nextData = interpolator.current(easeRef.current(step));
    visibleData.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (thisRunID: number) => {
    // Bail out if this run has already been superseded by a newer one.
    if (thisRunID !== runID.current) {
      return;
    }
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from what is currently visible toward the next target.
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      const subscribe = () => {
        // The delay may have outlived this run; only subscribe if still current.
        if (thisRunID !== runID.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed, timerDuration) =>
            functionToBeRunEachFrame(elapsed, timerDuration, thisRunID),
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = undefined;
          subscribe();
        }, delayRef.current);
      } else {
        subscribe();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  // Tracks the `data` prop the current run was started from so the effect below
  // can tell a genuine change from a mount / re-invocation with the same data.
  const prevData = React.useRef(data);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop so a queued completion cannot fire after the
    // component has unmounted. Bumping `runID` additionally neutralizes any
    // frame callback still holding a reference, belt-and-braces against a stray
    // completion.
    return () => {
      runID.current += 1;
      stopActiveTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The `[data]` effect also fires on mount (and again under StrictMode) with
    // the same reference; the queue is already primed by the mount effect above,
    // so only react to a genuine change of `data`.
    if (data === prevData.current) {
      return;
    }
    prevData.current = data;

    // Supersede any in-flight run so it can neither render nor complete, then
    // hand off from the currently visible style toward the new data. This is
    // repeatable: a change during a replacement or a queued step supersedes in
    // exactly the same way.
    runID.current += 1;
    stopActiveTimer();
    // Set the tween queue to the new data, preserving ordered array queues.
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
