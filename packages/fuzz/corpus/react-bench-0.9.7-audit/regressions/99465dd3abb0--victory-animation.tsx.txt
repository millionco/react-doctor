// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 99465dd3abb03ac3e5f0bcb120e64fcc9471267bcedb17eff1107d3ee1caea2b
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
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The style most recently rendered. Interpolation for the next animation
  // (a queued style or a new `data` prop) starts from this value, so a
  // replacement animation continues from wherever the current one left off.
  const currentStyle = React.useRef<AnimationStyle>(state.data);
  const isFirstRender = React.useRef(true);
  const ease = d3Ease[formatAnimationName(easing)];

  // The animation loop runs outside the render cycle, so it reads its
  // settings through this ref rather than closing over render-scoped values.
  // An animation that is already in progress adopts changes to `duration`,
  // `easing`, `delay`, and `onEnd` instead of finishing with the values it
  // started with.
  const instance = React.useRef({ timer, duration, ease, delay, onEnd });
  instance.current = { timer, duration, ease, delay, onEnd };

  const applyAnimationState = (newState: VictoryAnimationState) => {
    currentStyle.current = newState.data;
    setState(newState);
  };

  // Stop the delayed start or frame loop of the current animation. Once
  // canceled, a superseded animation can neither render nor complete.
  const cancelAnimation = () => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      instance.current.timer.unsubscribe(loopID.current);
    }
  };

  const beginAnimation = () => {
    timeoutID.current = undefined;
    loopID.current = instance.current.timer.subscribe(
      functionToBeRunEachFrame,
      instance.current.duration,
    );
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently rendered style to the next style
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      // Reset step to zero
      if (instance.current.delay) {
        timeoutID.current = setTimeout(beginAnimation, instance.current.delay);
      } else {
        beginAnimation();
      }
    } else if (instance.current.onEnd) {
      instance.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, ease: currentEase } = instance.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      applyAnimationState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current !== undefined) {
        instance.current.timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    applyAnimationState({
      data: interpolator.current(currentEase(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue();
      }
      return;
    }
    // New data supersedes the animation that is currently in progress: stop
    // it so it can no longer render or complete, set the tween queue to the
    // new data, and animate from the currently rendered style toward it.
    cancelAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Clean up the animation loop on unmount so that neither a pending frame
  // nor a delayed start can fire afterward.
  React.useEffect(() => {
    return () => {
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
      }
      if (loopID.current !== undefined) {
        instance.current.timer.unsubscribe(loopID.current);
      } else {
        instance.current.timer.stop();
      }
    };
  }, []);

  return children(state.data, state.animationInfo);
};
