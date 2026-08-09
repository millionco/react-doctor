// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 315f1fe6a8db4cd782509c4fae52a1bbbcc8bb23981362eeb5fe9e8248c3e3e9
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /**
   * Identifies the currently active run. Every time `data` changes (or the
   * component unmounts) this is incremented, which invalidates any frame
   * callback, delayed start, or queue step belonging to the superseded run.
   */
  const runID = React.useRef(0);

  /**
   * The style that is currently rendered. A new run interpolates from here, so
   * that replacing `data` mid-flight continues from what the user can see
   * rather than snapping to the abandoned target.
   */
  const currentData = React.useRef<AnimationStyle>(state.data);

  // Latest props, so an in-progress run picks up changes to them
  const latest = React.useRef({ duration, easing, delay, onEnd });
  latest.current = { duration, easing, delay, onEnd };

  const applyState = (nextState: VictoryAnimationState) => {
    currentData.current = nextState.data;
    setState(nextState);
  };

  /** Tears down the active run's timer and pending delayed start. */
  const cancelActiveRun = () => {
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    // A newer run has taken over; this one must neither render nor complete.
    if (id !== runID.current) return;

    if (!queue.current.length) {
      latest.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];
    const interpolator = victoryInterpolator(currentData.current, nextData);

    const onFrame = (elapsed: number) => {
      if (id !== runID.current) return;

      const { duration: currentDuration, easing: currentEasing } =
        latest.current;
      const ease = d3Ease[formatAnimationName(currentEasing)];

      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        applyState({
          data: interpolator(1),
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        cancelActiveRun();
        queue.current.shift();
        traverseQueue(id);
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      applyState({
        data: interpolator(ease(step)),
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    };

    const subscribe = () => {
      if (id !== runID.current) return;
      loopID.current = timer.subscribe(onFrame, latest.current.duration);
    };

    // Reset step to zero
    if (latest.current.delay) {
      delayID.current = setTimeout(subscribe, latest.current.delay);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    // Retire any run still in flight, then start a replacement from the
    // currently visible style toward the new data.
    cancelActiveRun();
    runID.current += 1;
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Clean up the animation loop on unmount
  React.useEffect(() => {
    return () => {
      runID.current += 1;
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
      if (delayID.current) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
