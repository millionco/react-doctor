// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d3b78d5849a62cf255a976924d4be1d1a9f5498f2f568c12a3e8bed7043f18c9
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
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  /**
   * Identifies the currently active run. Any callback (frame tick or delayed
   * start) that belongs to a superseded run is a no-op, so a stale animation
   * can neither render nor complete after newer props arrive.
   */
  const runID = React.useRef(0);
  const isMounted = React.useRef(false);

  /**
   * The latest props and the currently rendered style are read through refs so
   * that a long-lived timer subscription always uses up to date values rather
   * than the ones captured when the run started.
   */
  const latest = React.useRef({ duration, easing, delay, onEnd });
  latest.current = { duration, easing, delay, onEnd };

  const currentData = React.useRef(state.data);
  currentData.current = state.data;

  const cancelActiveRun = () => {
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }
  };

  const functionToBeRunEachFrame = (id: number) => (elapsed: number) => {
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } = latest.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      currentData.current = finalData;
      setState({
        data: finalData,
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
    const nextData = interpolator.current(ease(step));
    currentData.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently rendered style to the next target
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const { delay: currentDelay, duration: currentDuration } = latest.current;
      const subscribe = () => {
        if (id !== runID.current) return;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame(id),
          currentDuration,
        );
      };

      if (currentDelay) {
        delayTimeoutID.current = setTimeout(subscribe, currentDelay);
      } else {
        subscribe();
      }
    } else {
      interpolator.current = null;
      latest.current.onEnd?.();
    }
  };

  React.useEffect(() => {
    // Supersede any in-progress run and start a new one from the currently
    // rendered style toward the new data.
    cancelActiveRun();
    runID.current += 1;
    if (Array.isArray(data)) {
      // On mount the first entry is already the rendered style, so it is
      // dropped to preserve the ordered queue of the remaining entries.
      queue.current = isMounted.current ? data.slice() : data.slice(1);
    } else {
      queue.current = [data];
    }
    isMounted.current = true;
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop on unmount
    return () => {
      runID.current += 1;
      if (loopID.current) {
        cancelActiveRun();
      } else {
        cancelActiveRun();
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
