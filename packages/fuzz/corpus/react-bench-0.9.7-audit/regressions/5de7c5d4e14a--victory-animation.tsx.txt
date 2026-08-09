// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5de7c5d4e14a3e6d7bd7bdd3b677fb3b743091905362736610fdd3040ecf6c07
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import type Timer from "../victory-util/timer";

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

const toQueue = (data: AnimationData): AnimationStyle[] =>
  Array.isArray(data) ? data : [data];

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

  // Keep latest timing/end props available to in-flight frame callbacks.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Synchronous copy of the visible style so queue handoffs don't use stale state.
  const visibleDataRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

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
  // Incremented on data replacement / unmount so superseded callbacks are no-ops.
  const animationGeneration = React.useRef(0);

  const clearActiveTimer = React.useCallback((animationTimer: Timer) => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      animationTimer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, []);

  const traverseQueueRef = React.useRef<() => void>(() => {});
  const functionToBeRunEachFrameRef = React.useRef<
    (elapsed: number, generation: number) => void
  >(() => {});

  functionToBeRunEachFrameRef.current = (
    elapsed: number,
    generation: number,
  ) => {
    if (generation !== animationGeneration.current) return;
    if (!interpolator.current) return;

    const currentDuration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1.
    const step = currentDuration ? elapsed / currentDuration : 1;
    const ease =
      d3Ease[formatAnimationName(easingRef.current)] ||
      d3Ease[formatAnimationName("quadInOut")];

    if (step >= 1) {
      const finalData = interpolator.current(1);
      visibleDataRef.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      clearActiveTimer(timer);
      queue.current.shift();
      traverseQueueRef.current();
      return;
    }

    const nextData = interpolator.current(ease(step));
    visibleDataRef.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  traverseQueueRef.current = () => {
    const generation = animationGeneration.current;

    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      const start = () => {
        if (generation !== animationGeneration.current) return;
        loopID.current = timer.subscribe((elapsed) => {
          functionToBeRunEachFrameRef.current(elapsed, generation);
        }, durationRef.current);
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

  // Length check prevents triggering `onEnd` when there is nothing to animate.
  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    return () => {
      animationGeneration.current += 1;
      clearActiveTimer(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstDataEffect = React.useRef(true);
  React.useEffect(() => {
    // Skip the mount pass so we mirror componentDidUpdate behavior.
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }

    // Drop the in-progress run without jumping to its superseded target.
    animationGeneration.current += 1;
    clearActiveTimer(timer);
    interpolator.current = null;

    queue.current = toQueue(data);
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
