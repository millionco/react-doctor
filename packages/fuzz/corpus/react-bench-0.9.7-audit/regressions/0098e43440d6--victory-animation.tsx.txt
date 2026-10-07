// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0098e43440d66faff1635383b3320397dbcfc6294be26d07488398c435f96854
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
  const previousData = React.useRef(data);
  const ease = d3Ease[formatAnimationName(easing)];

  // The style most recently passed to `children`. Runs started while another
  // run is in progress interpolate from here, so they continue from the
  // visible style instead of jumping to the superseded run's target.
  const currentStyle = React.useRef(state.data);

  // The latest animation settings. The timer keeps calling the callback it was
  // subscribed with, so reading these through a ref lets an in-flight run
  // adopt changes to `duration`, `easing`, `delay` and `onEnd` instead of
  // finishing with the values captured when it was subscribed.
  const animationProps = React.useRef({ duration, delay, onEnd, ease });
  animationProps.current = { duration, delay, onEnd, ease };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Effects also run on mount, where the initial queue is already handled
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Stop the previous run so it can neither render nor complete with the
    // superseded target
    stopAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue from the currently visible style
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const setAnimationState = (
    newData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentStyle.current = newData;
    setState({ data: newData, animationInfo });
  };

  const stopAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    timer.unsubscribe(loopID.current);
  };

  const startAnimating = () => {
    loopID.current = timer.subscribe(
      functionToBeRunEachFrame,
      animationProps.current.duration,
    );
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      // Reset step to zero
      if (animationProps.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          startAnimating();
        }, animationProps.current.delay);
      } else {
        startAnimating();
      }
    } else if (animationProps.current.onEnd) {
      animationProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currentProps = animationProps.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentProps.duration ? elapsed / currentProps.duration : 1;

    if (step >= 1) {
      setAnimationState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState(interpolator.current(currentProps.ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  return children(state.data, state.animationInfo);
};
