// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 40cf7de115a4aa8e607c2228a1e95c6003f677a5bb681bd95227b50085d3510d
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
  // The first of an array of styles is rendered as given, the styles that follow
  // it are animated through in order
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
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
   * The timer keeps calling the frame callback it was subscribed with, and the
   * queue is traversed from that callback. Everything those need from props is
   * read from this ref, so that an animation already in progress runs with the
   * latest values instead of the ones it happened to start with.
   */
  const settings = React.useRef({ duration, ease, delay, onEnd });
  settings.current = { duration, ease, delay, onEnd };

  /**
   * The style currently displayed. Animations always start from here, so that
   * new data continues from what is on screen rather than from the target of the
   * animation it supersedes.
   */
  const displayed = React.useRef(state.data);

  /** The data the queue was built for. */
  const queuedData = React.useRef(data);

  /**
   * Identifies the animation being run. Frames and delayed starts scheduled by
   * an animation that has since been superseded are ignored.
   */
  const animationID = React.useRef(0);

  const setAnimationState = (nextState: VictoryAnimationState) => {
    displayed.current = nextState.data;
    setState(nextState);
  };

  /**
   * Stops the animation in progress, along with any frame or delayed start it
   * has already scheduled. Unsubscribing also stops the timer when this was its
   * last subscription.
   */
  const stopAnimation = () => {
    animationID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    timer.unsubscribe(loopID.current);
    loopID.current = undefined;
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop, so that nothing renders or completes the
    // animation once this component is gone
    return stopAnimation;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // This effect also runs for the initial data, which the queue is built for
    if (data === queuedData.current) {
      return;
    }
    queuedData.current = data;
    // Discard the animation in progress: it is superseded by the new data, so
    // it must not render or complete
    stopAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (!queue.current.length) {
      // Only the latest `onEnd` is called, even when the animation that just
      // completed was started with an earlier one.
      settings.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];

    // Compare the style being displayed to the next style in the queue
    interpolator.current = victoryInterpolator(displayed.current, nextData);

    const id = animationID.current;
    const subscribe = () => {
      loopID.current = timer.subscribe(
        (elapsed, subscribedDuration) =>
          functionToBeRunEachFrame(id, elapsed, subscribedDuration),
        settings.current.duration,
      );
    };

    // Reset step to zero
    if (settings.current.delay) {
      delayID.current = setTimeout(() => {
        delayID.current = undefined;
        // New data may have arrived while this step was waiting to start
        if (id === animationID.current) {
          subscribe();
        }
      }, settings.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (
    id: number,
    elapsed: number,
    subscribedDuration: number,
  ) => {
    // Frames belonging to a superseded animation must not render or complete it
    if (id !== animationID.current || !interpolator.current) return;

    // The timer reports a duration of zero while animations are bypassed, in
    // which case the animation goes straight to its final style
    const activeDuration =
      subscribedDuration === 0 ? 0 : settings.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      setAnimationState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState({
      data: interpolator.current(settings.current.ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
