// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b7497a2750dc49ec5eb6fc89fd6ab41befebb3f5e525049c0474024fc0b43e99
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

const getEasingFunction = (name: AnimationEasing) =>
  d3Ease[formatAnimationName(name)];

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
  /**
   * Identifies the animation run (one traversal of the tween queue) that the
   * scheduled callbacks belong to. Superseded runs are left with a stale id, so
   * anything they have scheduled becomes a no-op instead of rendering or
   * completing after newer data has taken over.
   */
  const runID = React.useRef(0);
  /** The style that is currently rendered, i.e. where the next run begins. */
  const currentStyle = React.useRef<AnimationStyle>(state.data);
  /** The data of the most recent render, to tell prop changes from re-runs. */
  const previousData = React.useRef<AnimationData>(data);
  /**
   * The timer callbacks below are created when an animation step starts, so
   * they can only see the props of the render that started it. Reading the
   * props that may change while an animation is in flight from a ref lets that
   * animation use the latest ones instead of the ones it was started with.
   */
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  const renderStyle = (
    nextStyle: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentStyle.current = nextStyle;
    setState({ data: nextStyle, animationInfo });
  };

  /**
   * Cancels everything the active run has scheduled and invalidates its id, so
   * that it can neither continue nor report completion.
   */
  const cancelActiveRun = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const startStep = (id: number) => {
    loopID.current = timer.subscribe(
      (elapsed) => functionToBeRunEachFrame(id, elapsed),
      latestProps.current.duration,
    );
  };

  const traverseQueue = (id: number) => {
    // Only the run that is still current may continue or call `onEnd`
    if (id !== runID.current) {
      return;
    }

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Animate from the style that is currently rendered to the next one
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      // Reset step to zero
      const { delay: currentDelay } = latestProps.current;
      if (currentDelay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          if (id === runID.current) {
            startStep(id);
          }
        }, currentDelay);
      } else {
        startStep(id);
      }
    } else {
      latestProps.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (id: number, elapsed: number) => {
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      renderStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    renderStyle(interpolator.current(getEasingFunction(currentEasing)(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop
    return () => {
      const hasActiveLoop = loopID.current !== undefined;
      cancelActiveRun();
      if (!hasActiveLoop) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The data of the first render is where the animation starts, and effects
    // may run again without new data, so only actual changes start a new run.
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Hand the animation over to the new data: the run in progress is dropped
    // where it is, without jumping to the target it never reached
    cancelActiveRun();
    // Set the tween queue to the new data. The queue is consumed as it is
    // traversed, so array data is copied rather than mutated in place.
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
