// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 25e27619e1e895eebaa77c919656aee78873f97326394dd6150f36ea3d565d94
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

  // A timer subscription only captures the render it was created in, but
  // props may change while it is active. Mirror the latest values into a ref
  // so an in-flight animation always reads the current duration, easing,
  // delay, and onEnd rather than the ones captured at subscribe time. The
  // most recently applied style is mirrored as well so a new run can start
  // from exactly what is on screen.
  const latest = React.useRef({
    duration,
    ease,
    delay,
    onEnd,
    style: state.data,
  });
  latest.current.duration = duration;
  latest.current.ease = ease;
  latest.current.delay = delay;
  latest.current.onEnd = onEnd;

  const applyState = (
    newData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    latest.current.style = newData;
    setState({ data: newData, animationInfo });
  };

  // Cancel both a pending delayed start and a live timer subscription so a
  // superseded run can neither render nor complete later
  const stopAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // This effect also runs on mount, where the initial queue is already
    // handled above; only respond to actual changes of `data`.
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Stop the in-progress run so it can neither render nor complete once
    // superseded
    stopAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue from the currently visible style
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the most recently applied style so each queued step
      // and each replacement run continues where the previous one left off
      interpolator.current = victoryInterpolator(
        latest.current.style,
        nextData,
      );

      // Reset step to zero
      if (latest.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            latest.current.duration,
          );
        }, latest.current.delay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          latest.current.duration,
        );
      }
    } else if (latest.current.onEnd) {
      latest.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, ease: currentEase } = latest.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      applyState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    applyState(interpolator.current(currentEase(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  return children(state.data, state.animationInfo);
};
