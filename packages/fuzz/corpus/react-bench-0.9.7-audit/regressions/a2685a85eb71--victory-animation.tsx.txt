// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit a2685a85eb715919069b10a6562c288ffea8eb94c0377f533d45e3e8dd43903c
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const ease = d3Ease[formatAnimationName(easing)];

  /**
   * Animations that are already running read their settings from this ref, so
   * that new `duration`, `easing` and `onEnd` props take effect immediately
   * instead of only applying to animations that start later. The settings are
   * synced after every render, and before the effects below, which react to
   * `data` from that same render.
   */
  const settings = React.useRef({ duration, delay, ease, onEnd });
  React.useEffect(() => {
    settings.current = { duration, delay, ease, onEnd };
  });

  /** The style that is currently rendered. Animations continue from here. */
  const renderedData = React.useRef<AnimationStyle>(state.data);
  /** The `data` prop the tween queue was built from. */
  const queuedData = React.useRef<AnimationData>(data);
  /**
   * Identifies the animation that is allowed to render and to call `onEnd`. It
   * is incremented whenever an animation is superseded or cancelled, so that
   * frames and delayed starts belonging to an older animation become inert.
   */
  const runID = React.useRef(0);

  const stopAnimation = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    // `loopID` is left in place so that unsubscribing stays this component's
    // responsibility, rather than stopping a timer that is shared with others.
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
    }
  };

  React.useEffect(() => {
    const previousData = queuedData.current;
    const isNewData = previousData !== data;
    queuedData.current = data;

    // A re-render that produces equivalent data leaves the running animation
    // alone, so that it keeps heading for the same target instead of starting
    // over. This is what allows `duration`, `easing` and `onEnd` to change
    // while an animation is in flight.
    if (isNewData && queue.current.length && isEqual(previousData, data)) {
      return;
    }

    // Any other new `data` prop replaces whatever is running: the superseded
    // animation is cancelled without rendering its target, and the replacement
    // animates from the style that is currently on screen.
    stopAnimation();

    // Set the tween queue to the new data. On the initial pass the first entry
    // of array data is already rendered, so only the entries after it need to
    // be animated to. Traversing the queue consumes it, so it is always a copy.
    const nextData = Array.isArray(data) ? data : [data];
    queue.current = nextData.slice(!isNewData && nextData.length > 1 ? 1 : 0);

    // Start traversing the tween queue
    traverseQueue(runID.current);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      // Cancelling here also keeps a pending frame or delayed start from
      // rendering or completing once the component is gone.
      stopAnimation();
      if (loopID.current === undefined) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const traverseQueue = (currentRunID: number) => {
    // Bail out if this animation has been superseded or cancelled.
    if (currentRunID !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the rendered version to next props
      interpolator.current = victoryInterpolator(
        renderedData.current,
        nextData,
      );

      // Reset step to zero
      if (settings.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          if (currentRunID !== runID.current) return;
          loopID.current = subscribeToTimer(currentRunID);
        }, settings.current.delay);
      } else {
        loopID.current = subscribeToTimer(currentRunID);
      }
    } else if (settings.current.onEnd) {
      // Only the latest `onEnd` is called, and only for the animation that
      // actually reached the end of the queue.
      settings.current.onEnd();
    }
  };

  const subscribeToTimer = (currentRunID: number) =>
    timer.subscribe(
      (elapsed) => functionToBeRunEachFrame(elapsed, currentRunID),
      settings.current.duration,
    );

  const functionToBeRunEachFrame = (elapsed: number, currentRunID: number) => {
    if (currentRunID !== runID.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = settings.current.duration
      ? elapsed / settings.current.duration
      : 1;

    if (step >= 1) {
      updateState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(currentRunID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    updateState(interpolator.current(settings.current.ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const updateState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    // Track the rendered style synchronously so that the next tween in the
    // queue, or an animation to new data, starts from what is on screen.
    renderedData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  return children(state.data, state.animationInfo);
};
