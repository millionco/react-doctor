// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 291775fca8a2bd1c4ab01e94afaef75c8f143885034d84e278e19fc16bce25f5
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

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );

  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutId = React.useRef<any>(undefined);

  const propsRef = React.useRef({ duration, easing, onEnd, delay });
  propsRef.current = { duration, easing, onEnd, delay };

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const traverseQueueRef = React.useRef<() => void>();

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current) return;

      const { duration: currentDuration, easing: currentEasing } = propsRef.current;
      const ease = d3Ease[formatAnimationName(currentEasing)];
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
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        queue.current.shift();
        if (traverseQueueRef.current) traverseQueueRef.current();
        return;
      }

      setState({
        data: interpolator.current(ease(step)),
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer],
  );

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      const { duration: currentDuration, delay: currentDelay } = propsRef.current;

      if (currentDelay) {
        timeoutId.current = setTimeout(() => {
          timeoutId.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            currentDuration,
          );
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      }
    } else {
      const { onEnd: currentOnEnd } = propsRef.current;
      if (currentOnEnd) {
        currentOnEnd();
      }
    }
  }, [timer, functionToBeRunEachFrame]);

  traverseQueueRef.current = traverseQueue;

  // Clean up the animation loop on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutId.current !== undefined) {
        clearTimeout(timeoutId.current);
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      }
    };
  }, [timer]);

  const isFirstMount = React.useRef(true);

  React.useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (queue.current.length) {
        traverseQueue();
      }
      return;
    }

    // Cancel existing loop if it exists
    if (timeoutId.current !== undefined) {
      clearTimeout(timeoutId.current);
      timeoutId.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue();
  }, [data, traverseQueue]);

  return children(state.data, state.animationInfo);
};
