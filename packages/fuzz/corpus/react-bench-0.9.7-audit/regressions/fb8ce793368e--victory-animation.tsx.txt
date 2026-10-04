// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit fb8ce793368ec455c19fbd9c3406d3df42ae1ab38f79458e7c593c1c05642aec
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
  const stateRef = React.useRef(state);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const previousData = React.useRef(data);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const activeTimer = React.useRef(timer);
  const runID = React.useRef(0);
  const stepID = React.useRef(0);
  const activeStepID = React.useRef<number | undefined>(undefined);
  const mounted = React.useRef(false);
  const settings = React.useRef({
    delay,
    duration,
    ease: d3Ease[formatAnimationName(easing)],
    onEnd,
    timer,
  });

  // Frame callbacks can outlive the render that created them. Keep all
  // mutable animation settings current without restarting the interpolation.
  settings.current = {
    delay,
    duration,
    ease: d3Ease[formatAnimationName(easing)],
    onEnd,
    timer,
  };

  const setAnimationState = (nextState: VictoryAnimationState) => {
    if (!mounted.current) {
      return;
    }

    stateRef.current = nextState;
    setState(nextState);
  };

  const isActiveStep = (currentRunID: number, currentStepID: number) =>
    mounted.current &&
    runID.current === currentRunID &&
    activeStepID.current === currentStepID;

  const cancelStep = () => {
    activeStepID.current = undefined;

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }

    if (loopID.current !== undefined) {
      activeTimer.current.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (currentRunID: number) => {
    if (!mounted.current || runID.current !== currentRunID) {
      return;
    }

    if (!queue.current.length) {
      settings.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];
    const interpolate = victoryInterpolator(stateRef.current.data, nextData);
    const currentStepID = ++stepID.current;
    activeStepID.current = currentStepID;

    const runFrame = (elapsed: number) => {
      if (!isActiveStep(currentRunID, currentStepID)) {
        return;
      }

      const { duration: latestDuration, ease } = settings.current;
      // Step can generate imprecise values, sometimes greater than 1. In that
      // case, render the exact target and finish the current queue entry.
      const step = latestDuration ? elapsed / latestDuration : 1;

      if (step >= 1) {
        activeStepID.current = undefined;
        const completedLoopID = loopID.current;
        loopID.current = undefined;
        if (completedLoopID !== undefined) {
          activeTimer.current.unsubscribe(completedLoopID);
        }

        setAnimationState({
          data: interpolate(1),
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        queue.current.shift();
        traverseQueue(currentRunID);
        return;
      }

      setAnimationState({
        data: interpolate(ease(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    const subscribe = () => {
      delayID.current = undefined;
      if (!isActiveStep(currentRunID, currentStepID)) {
        return;
      }

      const latestTimer = settings.current.timer;
      activeTimer.current = latestTimer;
      const subscriptionID = latestTimer.subscribe(
        runFrame,
        settings.current.duration,
      );

      // A custom timer may invoke its callback synchronously from subscribe.
      // If that completed or replaced the step, immediately discard the new
      // subscription instead of leaving a stale callback behind.
      if (isActiveStep(currentRunID, currentStepID)) {
        loopID.current = subscriptionID;
      } else {
        latestTimer.unsubscribe(subscriptionID);
      }
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(subscribe, settings.current.delay);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    const currentRunID = ++runID.current;

    // The first array item is rendered immediately; subsequent items retain
    // their original queue order.
    if (queue.current.length) {
      traverseQueue(currentRunID);
    }

    return () => {
      mounted.current = false;
      cancelStep();
    };
    // This effect owns the lifetime of the imperative animation controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Invalidate the old run before unsubscribing it. Even if its callback was
    // already queued, it can no longer render or complete.
    const currentRunID = ++runID.current;
    cancelStep();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(currentRunID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
