// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit cb176a6211e123e3c923f78bce8ac105480a557726902b8d59ad8f78c0fb6125
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
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isMounted = React.useRef(false);
  // Bumped whenever `data` changes, so callbacks belonging to a superseded
  // run can recognize that they've been replaced and stay silent.
  const runID = React.useRef(0);

  // Kept in sync every render so an already-running animation can pick up
  // the latest duration/easing/onEnd without restarting.
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easingRef = React.useRef(easing);
  easingRef.current = easing;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue();
      }
    } else {
      // `data` changed while mounted: start a new run that continues from
      // whatever style is currently visible, superseding any run in flight.
      runID.current += 1;
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }

    // Clean up the previous run before the next `data` change (or on unmount)
    return () => {
      clearTimeout(delayTimeoutID.current);
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    const thisRun = runID.current;
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to the next target
      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      const start = () => {
        // A newer `data` change may have superseded this run while we waited.
        if (thisRun !== runID.current) return;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame(thisRun),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delay) {
        delayTimeoutID.current = setTimeout(start, delay);
      } else {
        start();
      }
    } else if (thisRun === runID.current && onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (thisRun: number) => (elapsed: number) => {
    // A superseded run's subscription is unsubscribed, but guard anyway.
    if (thisRun !== runID.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
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
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(easingRef.current)];
    setState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
