// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 70a6fda669f149d753c0ebeb4d495cb234bd7877be47cfbc1ef25e4a0d81724c
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
  // Identifier for the current animation run. Whenever new `data` supersedes
  // the in-flight run this id is bumped, so stale timers, pending delayed
  // starts, and queued steps from a superseded run can never render or
  // complete afterwards.
  const runID = React.useRef(0);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Always read the latest props so that an in-progress animation adopts
  // updated `duration`, `easing`, and `onEnd` instead of finishing with the
  // settings that were current when its timer was subscribed.
  const latestProps = React.useRef({ duration, easing, onEnd, delay });
  latestProps.current = { duration, easing, onEnd, delay };
  // Mirror of the latest animation state, readable from timers without going
  // stale. It is updated synchronously with every state change so that
  // back-to-back frames and queued steps always build on the latest style.
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const stopActiveRun = () => {
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (run: number) => {
    // A superseded run must not start new steps or fire completion callbacks.
    if (run !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to the next target
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      // Reset step to zero
      const { delay: activeDelay, duration: activeDuration } =
        latestProps.current;
      if (activeDelay) {
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = undefined;
          if (run !== runID.current) return;
          loopID.current = timer.subscribe(
            (elapsed) => functionToBeRunEachFrame(run, elapsed),
            activeDuration,
          );
        }, activeDelay);
      } else {
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(run, elapsed),
          activeDuration,
        );
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (run: number, elapsed: number) => {
    if (run !== runID.current || !interpolator.current) return;

    const { duration: activeDuration, easing: activeEasing } =
      latestProps.current;
    const ease = d3Ease[formatAnimationName(activeEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      updateState({
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
      traverseQueue(run);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    updateState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop
    return () => {
      // Invalidate the active run so completion cannot fire after unmount.
      runID.current += 1;
      stopActiveRun();
      timer.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // A new `data` prop supersedes any in-progress or queued animation:
    // continue from the currently visible style toward the new data instead
    // of flashing the superseded target, and only complete the replacement run.
    runID.current += 1;
    const run = runID.current;

    // Cancel the existing loop (or pending delayed start) if it exists
    stopActiveRun();

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
