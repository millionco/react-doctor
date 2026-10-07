// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit ca8a544968179c6e7026e3bcafdd1de9a8994d028a529374550552b76fd6f586
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
  // The style most recently handed to `children`, so a superseding animation
  // can continue from exactly what is currently visible.
  const visibleData = React.useRef<AnimationStyle>(state.data);
  // Identifies the current animation run. Frames and delayed starts belonging
  // to a superseded run bail out instead of rendering or completing.
  const runID = React.useRef(0);
  // Timer callbacks outlive the render they were created in, so they read the
  // props through this ref to always use the latest values.
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  const applyState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop
    return () => {
      runID.current += 1;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousData = React.useRef(data);
  React.useEffect(() => {
    // Only respond to actual changes, not the initial mount
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;
    // Supersede any in-progress animation; its pending frames and delayed
    // start must neither render nor complete once replaced.
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    // Cancel existing loop if it exists
    timer.unsubscribe(loopID.current);
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue from the currently visible style
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (currentRunID: number) => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style to the next data
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      const subscribeToTimer = () => {
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, currentRunID),
          latestProps.current.duration,
        );
      };

      // Reset step to zero
      if (latestProps.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          if (currentRunID !== runID.current) return;
          subscribeToTimer();
        }, latestProps.current.delay);
      } else {
        subscribeToTimer();
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, currentRunID: number) => {
    if (currentRunID !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      applyState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(currentRunID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(currentEasing)];
    applyState(interpolator.current(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  return children(state.data, state.animationInfo);
};
