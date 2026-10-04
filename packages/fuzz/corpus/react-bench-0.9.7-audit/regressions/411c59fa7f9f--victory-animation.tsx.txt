// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 411c59fa7f9ff2519a1d44f8029da6b41bbaea87002fce2121fdda592171aa25
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

  // Keep the latest animation settings in a ref so that an in-flight animation
  // always reads the current `duration`, `easing`, `delay`, and `onEnd` rather
  // than the values captured when the run was first scheduled.
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  // Mirror the latest rendered state so timer callbacks (which run outside of
  // React's render cycle) can read the currently visible style synchronously.
  const stateRef = React.useRef(state);

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonically increasing token identifying the active run. Any frame or
  // delayed start belonging to a superseded run is ignored, so an outdated
  // animation can neither render nor complete after props change.
  const runID = React.useRef(0);
  const mounted = React.useRef(false);

  const setAnimationState = (next: VictoryAnimationState) => {
    stateRef.current = next;
    setState(next);
  };

  // Cancel the active frame loop and any pending delayed start.
  const stopCurrentRun = () => {
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (thisRun: number) => (elapsed: number) => {
    // Ignore frames from a run that has since been superseded.
    if (thisRun !== runID.current || !interpolator.current) {
      return;
    }

    const { duration: currentDuration, easing: currentEasing } =
      settings.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setAnimationState({
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
      traverseQueue(thisRun);
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

  const traverseQueue = (thisRun: number) => {
    // Bail out if this run has been superseded since it was scheduled.
    if (thisRun !== runID.current) {
      return;
    }

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target so
      // that mid-flight handoffs continue smoothly instead of jumping.
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      const { delay: currentDelay, duration: currentDuration } =
        settings.current;

      if (currentDelay) {
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = undefined;
          if (thisRun !== runID.current) {
            return;
          }
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame(thisRun),
            currentDuration,
          );
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame(thisRun),
          currentDuration,
        );
      }
    } else if (settings.current.onEnd) {
      // Always invoke the latest `onEnd` callback, never a superseded one.
      settings.current.onEnd();
    }
  };

  React.useEffect(() => {
    if (!mounted.current) {
      // Initial mount: begin traversing the queue seeded from array data.
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      mounted.current = true;
      if (queue.current.length) {
        traverseQueue(runID.current);
      }
      return;
    }

    // New data arrived. Invalidate the current run so its pending frames and
    // delayed starts do nothing, then hand off toward the new target from the
    // currently visible style without flashing the superseded target.
    runID.current += 1;
    stopCurrentRun();
    interpolator.current = null;
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop on unmount so a completion cannot fire after
    // the component is gone.
    return () => {
      runID.current += 1;
      stopCurrentRun();
      // Reset so a StrictMode remount re-seeds the queue rather than treating
      // the remount as a data change.
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
