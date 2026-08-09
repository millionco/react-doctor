// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5280986f74cca2690968eedb2d56d49407f55a31667d884ab787b2b667d733e7
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
  // The currently rendered style. New animations must start from what is on
  // screen, not from the style captured when the timer was subscribed.
  const visibleData = React.useRef<AnimationStyle>(state.data);
  // The timer callback outlives the render it was created in, so it reads
  // props through this ref to always honor the latest values.
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  const applyState = (newState: VictoryAnimationState) => {
    visibleData.current = newState.data;
    setState(newState);
  };

  // Unsubscribing an already-removed id is a safe no-op in Timer, so a stale
  // loopID after this call is harmless.
  const stopAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
    }
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      // Reset step to zero
      if (latestProps.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            latestProps.current.duration,
          );
        }, latestProps.current.delay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          latestProps.current.duration,
        );
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      applyState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      stopAnimation();
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(currentEasing)];
    applyState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue();
      }
      return;
    }

    // New data supersedes any in-progress animation: stop it without
    // rendering or completing it, and animate from the currently visible
    // style toward the new data.
    stopAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      isFirstRender.current = true;
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

  return children(state.data, state.animationInfo);
};
