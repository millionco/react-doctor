// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 16f1c87346dd2f823c2510872860ba5e0d0699bd15d7167e0e55047281cd3cba
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

  // Track latest props in refs to avoid stale closures in the timer loop
  const latestDuration = React.useRef(duration);
  const latestEasing = React.useRef(easing);
  const latestOnEnd = React.useRef(onEnd);
  const latestDelay = React.useRef(delay);

  React.useEffect(() => {
    latestDuration.current = duration;
    latestEasing.current = easing;
    latestOnEnd.current = onEnd;
    latestDelay.current = delay;
  }, [duration, easing, onEnd, delay]);

  // Keep a ref of the current visible data state for instant synchronous access
  const latestStateData = React.useRef<AnimationStyle>(state.data);

  const updateStateAndRef = (newData: AnimationStyle, info: AnimationInfo) => {
    latestStateData.current = newData;
    setState({ data: newData, animationInfo: info });
  };

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currDuration = latestDuration.current;
    const currEasing = latestEasing.current;
    const ease = d3Ease[formatAnimationName(currEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currDuration ? elapsed / currDuration : 1;

    if (step >= 1) {
      updateStateAndRef(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
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
    updateStateAndRef(interpolator.current(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        latestStateData.current,
        nextData,
      );

      const currDelay = latestDelay.current;
      const currDuration = latestDuration.current;

      // Reset step to zero
      if (currDelay) {
        delayTimeoutID.current = setTimeout(() => {
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            currDuration,
          );
        }, currDelay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currDuration,
        );
      }
    } else if (latestOnEnd.current) {
      latestOnEnd.current();
    }
  };

  const isMounted = React.useRef(false);

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      // Initial mount logic
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      if (queue.current.length > 0) {
        traverseQueue();
      }
    } else {
      // Data updated mid-run or on a subsequent update
      if (delayTimeoutID.current) {
        clearTimeout(delayTimeoutID.current);
        delayTimeoutID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }

      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (delayTimeoutID.current) {
        clearTimeout(delayTimeoutID.current);
        delayTimeoutID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
