// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 9ad6a9559ff7474270431ef3322d5cda0cfc1304a6964599d4c5217a7e6fce75
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
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
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
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  // Invalidates superseded frame callbacks and delayed starts.
  const animationGeneration = React.useRef(0);
  const isFirstDataEffect = React.useRef(true);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const visibleDataRef = React.useRef<AnimationStyle>(initialData);
  const traverseQueueRef = React.useRef<() => void>(() => {});

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const cancelActiveTimer = React.useCallback(() => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, subscribedDuration: number) => {
      if (!interpolator.current) return;

      const generation = animationGeneration.current;
      // Respect Timer bypass (duration 0); otherwise use the latest duration prop.
      const currentDuration =
        subscribedDuration === 0 ? 0 : durationRef.current;
      const ease = d3Ease[formatAnimationName(easingRef.current)];
      // Step can generate imprecise values, sometimes greater than 1
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator.current(1);
        if (generation !== animationGeneration.current) return;
        visibleDataRef.current = finalData;
        setState({
          data: finalData,
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
        if (generation !== animationGeneration.current) return;
        queue.current.shift();
        traverseQueueRef.current();
        return;
      }

      if (generation !== animationGeneration.current) return;
      const nextData = interpolator.current(ease(step));
      visibleDataRef.current = nextData;
      setState({
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer],
  );

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      const generation = animationGeneration.current;

      interpolator.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      const start = () => {
        if (generation !== animationGeneration.current) return;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayTimeoutID.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    return () => {
      animationGeneration.current += 1;
      cancelActiveTimer();
    };
  }, [cancelActiveTimer]);

  React.useEffect(() => {
    // Skip the initial mount; array queues are started by the mount effect.
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }

    // Continue from the currently visible style; do not flash the old target.
    animationGeneration.current += 1;
    cancelActiveTimer();
    interpolator.current = null;
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueueRef.current();
  }, [data, cancelActiveTimer]);

  return children(state.data, state.animationInfo);
};
