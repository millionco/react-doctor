// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 291bfed3795f21addcee426e3dc2a653d6492c819bf3bdc23b012cd4a582ac0c
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
  const timeoutID = React.useRef<any>(undefined);

  const latestProps = React.useRef({ duration, easing, onEnd });
  // Update latestProps synchronously during render, so it's always fresh
  latestProps.current = { duration, easing, onEnd };

  const latestState = React.useRef(state);
  latestState.current = state;

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (timeoutID.current) {
        clearTimeout(timeoutID.current);
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
    // Cancel existing loop or timeout if it exists
    if (timeoutID.current) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (startData = latestState.current.data) => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props (from the latest visible state)
      interpolator.current = victoryInterpolator(startData, nextData);

      // Reset step to zero
      if (delay) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            latestProps.current.duration || 0,
          );
        }, delay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          latestProps.current.duration || 0,
        );
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currentDuration = latestProps.current.duration || 0;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
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
      traverseQueue(finalData);
      return;
    }

    const currentEase =
      d3Ease[formatAnimationName(latestProps.current.easing || "quadInOut")];

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setState({
      data: interpolator.current(currentEase(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
