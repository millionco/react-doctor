// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit ecfc19b5b7b19a9f5c860c65c5dd7cba72a301110468de543e8321437c45e685
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const animationID = React.useRef(0);
  const stepID = React.useRef(0);
  const mounted = React.useRef(false);
  const currentState = React.useRef(state);
  const previousData = React.useRef(data);
  const latestProps = React.useRef({ duration, delay, onEnd });
  const ease = d3Ease[formatAnimationName(easing)];
  const latestEase = React.useRef(ease);

  // Timer callbacks outlive the render that created them. Keep the values
  // they need current without restarting an animation when props change.
  currentState.current = state;
  latestProps.current = { duration, delay, onEnd };
  latestEase.current = ease;

  const clearDelay = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const unsubscribeLoop = () => {
    if (loopID.current !== undefined) {
      const id = loopID.current;
      loopID.current = undefined;
      timer.unsubscribe(id);
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    currentAnimationID: number,
    currentStepID: number,
  ) => {
    if (
      !mounted.current ||
      currentAnimationID !== animationID.current ||
      currentStepID !== stepID.current ||
      !interpolator.current
    ) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1. If this
    // happens set the state to 1 and return, cancelling the timer.
    const currentInterpolator = interpolator.current;
    const currentDuration = latestProps.current.duration;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = currentInterpolator(1);
      const finalState = {
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      };

      // The next queued step may start before React renders this state, so
      // keep the visible value available synchronously for its interpolator.
      currentState.current = finalState;
      setState(finalState);
      unsubscribeLoop();
      queue.current.shift();

      if (queue.current.length) {
        traverseQueue(currentAnimationID);
      } else {
        interpolator.current = null;
        if (latestProps.current.onEnd) {
          latestProps.current.onEnd();
        }
      }
      return;
    }

    const nextState = {
      data: currentInterpolator(latestEase.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    };

    currentState.current = nextState;
    setState(nextState);
  };

  const traverseQueue = (currentAnimationID: number) => {
    if (!mounted.current || currentAnimationID !== animationID.current) {
      return;
    }

    if (!queue.current.length) {
      if (latestProps.current.onEnd) {
        latestProps.current.onEnd();
      }
      return;
    }

    const nextData = queue.current[0];
    const currentStepID = ++stepID.current;

    // Compare the currently visible style to the next item in the queue.
    interpolator.current = victoryInterpolator(
      currentState.current.data,
      nextData,
    );

    const subscribe = () => {
      delayID.current = undefined;
      if (
        !mounted.current ||
        currentAnimationID !== animationID.current ||
        currentStepID !== stepID.current
      ) {
        return;
      }
      const subscriptionID = timer.subscribe(
        (elapsed) =>
          functionToBeRunEachFrame(elapsed, currentAnimationID, currentStepID),
        latestProps.current.duration,
      );
      if (
        mounted.current &&
        currentAnimationID === animationID.current &&
        currentStepID === stepID.current &&
        interpolator.current
      ) {
        loopID.current = subscriptionID;
      } else {
        timer.unsubscribe(subscriptionID);
      }
    };

    if (latestProps.current.delay) {
      delayID.current = setTimeout(subscribe, latestProps.current.delay);
    } else {
      subscribe();
    }
  };

  const replaceAnimation = (nextData: AnimationData) => {
    animationID.current += 1;
    stepID.current += 1;
    clearDelay();
    unsubscribeLoop();
    interpolator.current = null;
    queue.current = Array.isArray(nextData) ? nextData.slice() : [nextData];
    traverseQueue(animationID.current);
  };

  React.useEffect(() => {
    mounted.current = true;

    // Length check prevents us from triggering `onEnd` in `traverseQueue` on
    // the initial render.
    if (queue.current.length) {
      traverseQueue(animationID.current);
    }

    // Clean up the animation loop and any delayed start.
    return () => {
      mounted.current = false;
      animationID.current += 1;
      stepID.current += 1;
      clearDelay();

      if (loopID.current !== undefined) {
        unsubscribeLoop();
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current !== data) {
      previousData.current = data;
      replaceAnimation(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
