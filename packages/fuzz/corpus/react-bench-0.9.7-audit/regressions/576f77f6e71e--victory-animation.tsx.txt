// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 576f77f6e71e113a3bf045cb2831762e92b610c5ce323fef9dfbf2cc68b4c940
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

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const timer = React.useContext(TimerContext).animationTimer;

  const latestProps = React.useRef({ duration, easing, delay, onEnd, timer });
  latestProps.current = { duration, easing, delay, onEnd, timer };

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );

  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );

  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutId = React.useRef<any>(null);

  const traverseQueueRef = React.useRef<() => void>(() => {});
  const callbackRef = React.useRef<(elapsed: number) => void>(() => {});

  const functionToBeRunEachFrame = React.useCallback((elapsed: number) => {
    callbackRef.current(elapsed);
  }, []);

  callbackRef.current = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;
    const ease = d3Ease[formatAnimationName(currentEasing || "quadInOut")];

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
        latestProps.current.timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueueRef.current();
      return;
    }

    setState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      const {
        delay: currentDelay,
        duration: currentDuration,
        timer: currentTimer,
      } = latestProps.current;

      // Reset step to zero
      if (currentDelay) {
        timeoutId.current = setTimeout(() => {
          timeoutId.current = null;
          loopID.current = currentTimer.subscribe(
            functionToBeRunEachFrame,
            currentDuration,
          );
        }, currentDelay);
      } else {
        loopID.current = currentTimer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    // Clean up the animation loop
    return () => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      if (loopID.current) {
        latestProps.current.timer.unsubscribe(loopID.current);
      } else {
        latestProps.current.timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isMounted = React.useRef(false);

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }

    // Cancel existing loop and timeout if they exist
    if (timeoutId.current) {
      clearTimeout(timeoutId.current);
      timeoutId.current = null;
    }
    if (loopID.current) {
      latestProps.current.timer.unsubscribe(loopID.current);
    }

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueueRef.current();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
