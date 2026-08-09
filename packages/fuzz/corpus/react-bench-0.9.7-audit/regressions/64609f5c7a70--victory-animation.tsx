// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 64609f5c7a70a23c306ffadc0d360814e1f743006fbb5575445facef30abd358
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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
  const delayTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * The most recently rendered style. Tracked in a ref so that effect
   * closures can start a replacement run from the currently visible style
   * instead of a stale render snapshot.
   */
  const latestData = React.useRef(state.data);
  /**
   * Identifies the current animation run. Frames, delayed starts, and
   * completions are ignored once they no longer belong to the active run,
   * so a superseded run can neither render nor complete.
   */
  const activeRunID = React.useRef(0);
  /**
   * Mirrors the latest props so the active animation loop always uses the
   * most recent `duration`, `easing`, and `onEnd`.
   */
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };
  /**
   * The data effect below should only react to data *changes*, not to the
   * initial mount (which is handled by the mount effect above).
   */
  const isInitialMount = React.useRef(true);
  /**
   * The target of the active (or most recently completed) run. Rerenders
   * that deliver the same target - for instance a fresh object identity
   * with equal values - must not restart a finished run or supersede an
   * equivalent in-progress run.
   */
  const targetData = React.useRef<AnimationData>(data);
  /**
   * The duration the active run is using. When the `duration` prop changes
   * mid-run, the active animation adopts the new duration by resubscribing
   * with a fresh clock.
   */
  const activeDuration = React.useRef(duration);

  const setAnimationState = (nextState: VictoryAnimationState) => {
    latestData.current = nextState.data;
    setState(nextState);
  };

  const stopActiveRun = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimer.current !== undefined) {
      clearTimeout(delayTimer.current);
      delayTimer.current = undefined;
    }
  };

  const traverseQueue = (runID: number) => {
    if (runID !== activeRunID.current) return;
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(latestData.current, nextData);

      // Reset step to zero
      const { delay: currentDelay, duration: currentDuration } =
        latestProps.current;
      activeDuration.current = currentDuration;
      if (currentDelay) {
        delayTimer.current = setTimeout(() => {
          delayTimer.current = undefined;
          if (runID !== activeRunID.current) return;
          loopID.current = timer.subscribe(
            (elapsed, timerDuration) =>
              functionToBeRunEachFrame(runID, elapsed, timerDuration),
            currentDuration,
          );
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(
          (elapsed, timerDuration) =>
            functionToBeRunEachFrame(runID, elapsed, timerDuration),
          currentDuration,
        );
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    runID: number,
    elapsed: number,
    timerDuration?: number,
  ) => {
    // A superseded run must not render or complete.
    if (runID !== activeRunID.current) return;
    if (!interpolator.current) return;

    // The active animation always uses the latest duration and easing. The
    // timer may coerce the subscribed duration (e.g. to 0 while animations
    // are bypassed), which takes precedence so the run completes instantly.
    const { easing: currentEasing } = latestProps.current;
    const durationToUse =
      timerDuration !== undefined
        ? timerDuration
        : latestProps.current.duration;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = durationToUse ? elapsed / durationToUse : 1;

    if (step >= 1) {
      setAnimationState({
        data: interpolator.current(1),
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
      queue.current.shift();
      traverseQueue(runID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`
    // before any animation has run.
    if (queue.current.length) {
      traverseQueue(activeRunID.current);
    }

    // Clean up the active animation run on unmount so completion cannot
    // fire afterwards.
    return () => {
      activeRunID.current++;
      stopActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // The active animation adopts a new duration mid-run. If it is waiting
    // on a delay, reschedule the delayed start with the new duration.
    if (duration !== activeDuration.current && state.animationInfo.animating) {
      const runID = activeRunID.current;
      activeDuration.current = duration;
      if (delayTimer.current !== undefined) {
        clearTimeout(delayTimer.current);
        delayTimer.current = setTimeout(() => {
          delayTimer.current = undefined;
          if (runID !== activeRunID.current) return;
          loopID.current = timer.subscribe(
            (elapsed, timerDuration) =>
              functionToBeRunEachFrame(runID, elapsed, timerDuration),
            duration,
          );
        }, latestProps.current.delay);
      } else if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = timer.subscribe(
          (elapsed, timerDuration) =>
            functionToBeRunEachFrame(runID, elapsed, timerDuration),
          duration,
        );
      }
    }
    if (isEqual(targetData.current, data)) {
      return;
    }
    targetData.current = data;
    // New data supersedes any in-progress run. Start a replacement run from
    // the currently visible style toward the new data, and let only this
    // replacement run render and complete.
    activeRunID.current++;
    stopActiveRun();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue(activeRunID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
