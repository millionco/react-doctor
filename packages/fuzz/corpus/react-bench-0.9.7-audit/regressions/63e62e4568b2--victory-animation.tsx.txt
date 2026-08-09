// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 63e62e4568b222110554f197ce4d0858ac57c2d8d08813ed3e13657ff7afef38
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
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * Identifies the animation run that is currently allowed to render and
   * complete. Superseded runs hold an older token and bail out.
   */
  const runID = React.useRef(0);
  const isFirstRun = React.useRef(true);

  // Animations already in flight read their settings from here, so that they
  // pick up the latest props instead of the ones captured when they started.
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  // The currently rendered style, so a replacement run can continue from it.
  const latestState = React.useRef(state);
  latestState.current = state;

  /** Keeps `latestState` in sync synchronously, before React re-renders. */
  const applyState = (nextState: VictoryAnimationState) => {
    latestState.current = nextState;
    setState(nextState);
  };

  /** Invalidates the active run and stops its timer/delay. */
  const cancelActiveAnimation = () => {
    runID.current += 1;
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    return runID.current;
  };

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
      }
      // Invalidate any frame that is already queued for this run
      runID.current += 1;
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Cancel the in-flight animation, if any, and claim the new run
    const token = cancelActiveAnimation();

    if (isFirstRun.current) {
      isFirstRun.current = false;
      // The first entry is already rendered, so only queue what follows it.
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (!queue.current.length) return;
    } else {
      // Set the tween queue to the new data
      queue.current = Array.isArray(data) ? data : [data];
    }

    // Start traversing the tween queue from whatever is currently visible
    traverseQueue(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (token: number) => {
    if (token !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently rendered style to the next target
      interpolator.current = victoryInterpolator(
        latestState.current.data,
        nextData,
      );

      const subscribe = () => {
        if (token !== runID.current) return;
        timeoutID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, token),
          latestProps.current.duration,
        );
      };

      // Reset step to zero
      if (latestProps.current.delay) {
        timeoutID.current = setTimeout(subscribe, latestProps.current.delay);
      } else {
        subscribe();
      }
    } else {
      latestProps.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, token: number) => {
    // A newer run has taken over; this frame must not render or complete.
    if (token !== runID.current || !interpolator.current) return;

    const currentDuration = latestProps.current.duration;

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
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(token);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(latestProps.current.easing)];
    applyState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
