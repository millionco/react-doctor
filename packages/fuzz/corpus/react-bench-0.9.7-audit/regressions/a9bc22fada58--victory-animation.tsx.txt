// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit a9bc22fada58ec1645b902d38aba6622e2ee4725e0cbafac8090f20d07acbd0d
import React from "react";
import isEqual from "react-fast-compare";
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

  /**
   * An animation is driven by a callback that was created when the animation
   * started, so the settings it needs are read from this ref rather than from
   * the closure it was created in. That way a run which is already in flight
   * finishes with the latest `duration`, `easing` and `onEnd` instead of the
   * ones it happened to start with.
   */
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  /**
   * Identifies the run that a scheduled callback belongs to. Superseded runs
   * (new `data`, or an unmount) bump this, so any frame, queue step, or `onEnd`
   * still pending for the previous run becomes a no-op.
   */
  const runID = React.useRef(0);

  /** The style that is currently rendered, i.e. the start of the next tween. */
  const currentData = React.useRef(state.data);

  /** The `data` the current run was started for, to detect a new target. */
  const previousData = React.useRef(data);

  const renderFrame = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  /**
   * Stop whatever is scheduled, and make its pending callbacks inert.
   * `loopID` is kept, rather than cleared, so that it still records whether this
   * component ever subscribed to the timer.
   */
  const cancelRun = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
    }
  };

  const traverseQueue = (id: number) => {
    // Bail out if this run has been superseded by a newer one.
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the style that is currently rendered to the next one
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      // Each step gets its own subscription, which resets step to zero
      const subscribe = () => {
        delayID.current = undefined;
        if (id !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(id, elapsed),
          settings.current.duration,
        );
      };

      if (settings.current.delay) {
        delayID.current = setTimeout(subscribe, settings.current.delay);
      } else {
        subscribe();
      }
    } else {
      interpolator.current = null;
      // Only the callback given for the run that actually completed is called
      const { onEnd: currentOnEnd } = settings.current;
      if (currentOnEnd) {
        currentOnEnd();
      }
    }
  };

  const functionToBeRunEachFrame = (id: number, elapsed: number) => {
    // Frames belonging to a superseded run must neither render nor complete
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      renderFrame(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current = queue.current.slice(1);
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(currentEasing)];
    renderFrame(interpolator.current(ease(step)), {
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
      // Nothing left over may render or complete once we are unmounted
      cancelRun();
      if (!loopID.current) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const isNewTarget = !isEqual(previousData.current, data);
    previousData.current = data;

    // Skip the initial render, when the queue is already primed above, and any
    // update that re-declares the values the current run is already heading
    // for: such a run keeps going, picking up the settings it was given.
    if (!isNewTarget && interpolator.current) return;

    // Hand off from the animation in progress: it is cancelled where it stands,
    // without jumping to the target it will never reach, and it can no longer
    // render or invoke `onEnd`.
    cancelRun();

    // Set the tween queue to the new data, starting from the visible style
    queue.current = Array.isArray(data) ? data.slice() : [data];

    // Start traversing the tween queue
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
