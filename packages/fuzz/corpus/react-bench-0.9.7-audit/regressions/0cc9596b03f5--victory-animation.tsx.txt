// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0cc9596b03f5b0bd255b95d4c6728773852584bfd98091633e8c8f3c6d2ee394
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

/**
 * The tween targets to animate through, in order. Copied because the queue is
 * consumed by shifting entries off of it as each tween finishes.
 */
const toQueue = (data: AnimationData): AnimationStyle[] =>
  Array.isArray(data) ? data.slice() : [data];

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
  /**
   * `state.data` already renders the first entry of array data, so the queue
   * starts at the entry after it. A single-entry array has nothing after it, so
   * it stays its own target.
   */
  const queue = React.useRef<AnimationStyle[]>(
    !Array.isArray(data) || data.length < 2 ? toQueue(data) : data.slice(1),
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /**
   * An animation is driven by callbacks handed to the shared timer, and those
   * callbacks outlive the render that created them. Reading through these refs
   * lets a running animation pick up the current props and the style that is
   * currently on screen, rather than whatever was in scope when it started.
   */
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };
  const currentData = React.useRef(state.data);

  /**
   * Identifies the animation that is allowed to render and report completion.
   * Bumping it retires whatever is in flight: superseded callbacks see an id
   * that no longer matches and bail out.
   */
  const runID = React.useRef(0);

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    // Kept in sync eagerly so the next tween starts from the visible style
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  /** Retires the animation in flight and returns the id of its replacement. */
  const retireActiveAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    // Cancel existing loop if it exists
    timer.unsubscribe(loopID.current);
    runID.current += 1;
    return runID.current;
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (!queue.current.length) {
      // Read through the ref so a callback swapped in mid-animation wins
      latestProps.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];

    // Tween from the style currently on screen to the next target
    interpolator.current = victoryInterpolator(currentData.current, nextData);

    // Reset step to zero
    const subscribe = () => {
      if (id !== runID.current) return;
      delayID.current = undefined;
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(id, elapsed),
        latestProps.current.duration,
      );
    };

    if (latestProps.current.delay) {
      delayID.current = setTimeout(subscribe, latestProps.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (id: number, elapsed: number) => {
    // A superseded animation must neither render nor report completion
    if (id !== runID.current) return;
    if (!interpolator.current) return;

    const { duration: activeDuration, easing: activeEasing } =
      latestProps.current;
    const ease = d3Ease[formatAnimationName(activeEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      setAnimationState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState(interpolator.current(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const queuedData = React.useRef(data);

  React.useEffect(() => {
    const id = retireActiveAnimation();

    if (data !== queuedData.current) {
      queuedData.current = data;
      // Set the tween queue to the new data. `traverseQueue` picks up from the
      // style currently on screen, so the superseded target is never rendered.
      queue.current = toQueue(data);
    }

    // Start traversing the tween queue
    traverseQueue(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      // Retire the animation so a queued step cannot complete after unmount
      runID.current += 1;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
