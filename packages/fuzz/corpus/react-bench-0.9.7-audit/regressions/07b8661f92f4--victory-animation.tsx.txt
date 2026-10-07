// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 07b8661f92f453fac2a3482ee6bf9e123fb0baecab0055d2a9b49c41a15cabb5
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
  const ease = d3Ease[formatAnimationName(easing)];

  /**
   * Animations may outlive the props they were started with. Timer callbacks
   * read the latest values from these refs instead of closing over the props of
   * the render that started the animation.
   */
  const latest = React.useRef({ duration, ease, delay, onEnd });
  latest.current = { duration, ease, delay, onEnd };

  /**
   * The style currently being rendered. A new animation always starts from
   * here, so interrupting an animation never flashes an intermediate target.
   */
  const currentData = React.useRef<AnimationStyle>(state.data);

  /**
   * Identifies the active run. Cancelling a run increments it, which makes any
   * callback belonging to a superseded run a no-op, so it can neither render
   * nor complete.
   */
  const runID = React.useRef(0);

  /** The mount effect below owns the first run, so the data effect skips it */
  const isInitialData = React.useRef(true);

  const setAnimationState = (nextState: VictoryAnimationState) => {
    currentData.current = nextState.data;
    setState(nextState);
  };

  /** Stop the active run (and any pending delayed start) without completing it */
  const cancelRun = () => {
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

  const traverseQueue = () => {
    // Captured so that callbacks scheduled here can detect being superseded.
    const currentRunID = runID.current;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const subscribe = () => {
        if (currentRunID !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, currentRunID),
          latest.current.duration,
        );
      };

      // Reset step to zero
      if (latest.current.delay) {
        delayID.current = setTimeout(subscribe, latest.current.delay);
      } else {
        subscribe();
      }
    } else {
      interpolator.current = null;
      // Only the run that is still active may complete, and it completes with
      // the most recently provided callback.
      latest.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, currentRunID: number) => {
    // A superseded run must not render or complete
    if (currentRunID !== runID.current) return;
    if (!interpolator.current) return;

    const { duration: currentDuration, ease: currentEase } = latest.current;

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
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState({
      data: interpolator.current(currentEase(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop so that a pending frame cannot complete
    // after unmount
    return () => {
      // Unsubscribing stops the shared timer once nothing is animating.
      cancelRun();
      // Allow the initial queue to be re-established if this instance is
      // mounted again (as it is in `StrictMode`).
      isInitialData.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial queue is set up on mount, above.
    if (isInitialData.current) {
      isInitialData.current = false;
      return;
    }

    // Abandon the in-progress animation without rendering or completing it
    cancelRun();
    // Set the tween queue to the new data. The replacement run picks up from
    // the currently rendered style. Array data is copied, as the queue is
    // consumed as it is traversed.
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
