// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c53bffe795a9b8494a70ce93753a803c66bdc056ea5a321dcd6c11cd175a4054
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
  const timer = React.useContext(TimerContext).animationTimer;

  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };

  const lastComputedData = React.useRef<AnimationStyle>(state.data);
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const isMounted = React.useRef(false);

  const clearTimerAndTimeout = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(
        lastComputedData.current,
        nextData,
      );

      const { delay: currentDelay, duration: currentDuration } =
        propsRef.current;

      const startAnimation = () => {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      };

      if (currentDelay) {
        timeoutID.current = setTimeout(startAnimation, currentDelay);
      } else {
        startAnimation();
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
  }, []);

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current) return;

      const { duration: currentDuration, easing: currentEasing } =
        propsRef.current;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator.current(1);
        lastComputedData.current = finalData;
        setState({
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        clearTimerAndTimeout();
        queue.current.shift();
        traverseQueue();
        return;
      }

      const ease = d3Ease[formatAnimationName(currentEasing)];
      const currentData = interpolator.current(ease(step));
      lastComputedData.current = currentData;

      setState({
        data: currentData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [traverseQueue, clearTimerAndTimeout],
  );

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      if (queue.current.length) {
        traverseQueue();
      }
    } else {
      clearTimerAndTimeout();
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    return () => {
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
