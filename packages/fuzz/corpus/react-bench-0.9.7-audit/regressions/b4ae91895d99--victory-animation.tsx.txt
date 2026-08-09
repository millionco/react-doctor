// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b4ae91895d99e572b2e1a0c3d0db9fdb721af28727169e0126068ee61aa705f4
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
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /**
   * The style that is currently rendered. Animations always start from this
   * value, so that new data may be animated toward without any visual jumps.
   */
  const currentData = React.useRef<AnimationStyle>(state.data);

  /**
   * Identifies the animation that is allowed to render and complete. Work that
   * was scheduled by a superseded animation checks this value and bails out.
   */
  const animationID = React.useRef(0);

  /**
   * An animation that is already in progress should use the most recently
   * received props, so they are read through a ref instead of a closure.
   */
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  const isInitialRun = React.useRef(true);

  /** Stop the animation in progress, so that it may never render or complete */
  const cancelAnimation = () => {
    animationID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    // This animation has been replaced by a newer one
    if (id !== animationID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the style that is currently rendered to the next data, so that
      // an animation replacing another continues from where it left off
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const subscribe = () => {
        if (id !== animationID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          createFrameHandler(id),
          latestProps.current.duration,
        );
      };

      // Reset step to zero
      if (latestProps.current.delay) {
        delayID.current = setTimeout(subscribe, latestProps.current.delay);
      } else {
        subscribe();
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const createFrameHandler = (id: number) => (elapsed: number) => {
    // This animation has been replaced by a newer one
    if (id !== animationID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      currentData.current = interpolator.current(1);
      setState({
        data: currentData.current,
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
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    currentData.current = interpolator.current(ease(step));
    setState({
      data: currentData.current,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    if (isInitialRun.current) {
      isInitialRun.current = false;
      // The initial data is already rendered, so an array of data only needs
      // to animate toward the values that follow it.
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue(animationID.current);
      }
      return;
    }

    // Hand the animation in progress off to the new data, rather than letting
    // it finish with data and props that are no longer current
    cancelAnimation();
    // Set the tween queue to the new data. The queue is consumed as it is
    // traversed, so it must be a copy of the data that was given.
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue(animationID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      const hasActiveLoop = Boolean(loopID.current);
      cancelAnimation();
      if (!hasActiveLoop) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
