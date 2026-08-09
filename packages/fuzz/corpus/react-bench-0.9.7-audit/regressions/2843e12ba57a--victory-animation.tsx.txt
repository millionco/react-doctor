// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2843e12ba57ac5a12c38db68c142e364a8705651928ac613075ce8c35da227a3
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
  /**
   * The animation loop runs outside of the render cycle, so it can't read props
   * or state from the closure it was created in without going stale. These refs
   * hold the current values, so an animation that is already in progress picks
   * up the latest props and continues from the style that is on screen.
   */
  const animationProps = React.useRef({ duration, easing, delay, onEnd });
  const currentState = React.useRef(state);
  /**
   * Identifies the animation run that is allowed to render and complete. When a
   * run is superseded this is incremented, so frames belonging to the old run
   * (and its `onEnd`) become no-ops.
   */
  const runID = React.useRef(0);
  const previousData = React.useRef(data);

  React.useEffect(() => {
    animationProps.current = { duration, easing, delay, onEnd };
  }, [duration, easing, delay, onEnd]);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      // Invalidate the run in progress so it can neither render nor complete
      runID.current += 1;
      cancelAnimation();
      if (loopID.current === undefined) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial data is already applied to state, and any queued values are
    // started by the mount effect above
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Supersede the animation in progress. It must not render or complete, and
    // its target is never displayed, so there is no flash of superseded data
    runID.current += 1;
    cancelAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue from the style that is on screen
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const updateState = (nextState: VictoryAnimationState) => {
    currentState.current = nextState;
    setState(nextState);
  };

  const cancelAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
    }
  };

  const traverseQueue = () => {
    // Frames and delayed starts are tied to the run that scheduled them
    const currentRunID = runID.current;

    if (queue.current.length) {
      const nextData = queue.current[0];
      const { duration: nextDuration, delay: nextDelay } =
        animationProps.current;

      // Interpolate from the currently rendered style to the next value in the
      // queue, so interrupted animations continue from where they left off
      interpolator.current = victoryInterpolator(
        currentState.current.data,
        nextData,
      );

      const subscribe = () => {
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(currentRunID, elapsed),
          nextDuration,
        );
      };

      // Reset step to zero
      if (nextDelay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          // Don't start a run that was superseded while it was waiting
          if (currentRunID === runID.current) {
            subscribe();
          }
        }, nextDelay);
      } else {
        subscribe();
      }
    } else {
      // Always call the most recent `onEnd`, never the one this run started with
      const { onEnd: currentOnEnd } = animationProps.current;
      if (currentOnEnd) {
        currentOnEnd();
      }
    }
  };

  const functionToBeRunEachFrame = (currentRunID: number, elapsed: number) => {
    // A superseded run must not render or complete
    if (currentRunID !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      animationProps.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      updateState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      cancelAnimation();
      queue.current = queue.current.slice(1);
      traverseQueue();
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

  return children(state.data, state.animationInfo);
};
