// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit ecdddd5280286929c4294eb25103416c3d77bae4472b7e57ae750902bfa6c961
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

  // Mutable animation state, kept in a ref so that the animation loop can be
  // handed off (and its settings updated) from effects without going stale.
  const animationRef = React.useRef({
    // The ordered queue of styles left to interpolate towards
    queue: (Array.isArray(data) ? data.slice(1) : []) as AnimationStyle[],
    // The interpolated style rendered most recently; the starting point for
    // the next step of the animation
    currentStyle: (Array.isArray(data) ? data[0] : data) as AnimationStyle,
    interpolator: null as null | ((value: number) => AnimationStyle),
    loopID: undefined as number | undefined,
    delayTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    duration,
    easing,
    onEnd,
  });
  const animation = animationRef.current;
  // Track the last `data` that the animation was pointed at, so that the
  // data effect only reacts to actual data changes (and not to the initial
  // mount, re-renders with identical data, or StrictMode effect replays)
  const lastDataRef = React.useRef(data);

  // Keep track of the latest props so that the active animation always uses
  // the most recent settings, even when they change mid-run
  React.useEffect(() => {
    animation.duration = duration;
    animation.easing = easing;
    animation.onEnd = onEnd;
  });

  React.useEffect(() => {
    // Start the initial animation (if the initial data was an array with
    // more than one entry), and stop the animation loop on unmount so that
    // completion can never fire after the component is gone.
    if (animation.queue.length) {
      traverseQueue();
    }

    return () => {
      if (animation.loopID) {
        timer.unsubscribe(animation.loopID);
      } else {
        timer.stop();
      }
      if (animation.delayTimer) {
        clearTimeout(animation.delayTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (lastDataRef.current === data) {
      // The animation is already headed towards this data, so there is
      // nothing to hand off
      return;
    }
    lastDataRef.current = data;

    // Hand off the animation to the new data. The animation continues from
    // the currently visible style (never rendering the superseded target)
    // towards the new data, and only the replacement run will complete.
    if (animation.loopID) {
      timer.unsubscribe(animation.loopID);
      animation.loopID = undefined;
    }
    if (animation.delayTimer) {
      clearTimeout(animation.delayTimer);
      animation.delayTimer = undefined;
    }
    animation.queue = Array.isArray(data) ? [...data] : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (animation.queue.length) {
      const nextData = animation.queue[0];

      // Interpolate from the currently visible style towards the next data
      animation.interpolator = victoryInterpolator(
        animation.currentStyle,
        nextData,
      );

      const start = () => {
        animation.delayTimer = undefined;
        animation.loopID = timer.subscribe(
          functionToBeRunEachFrame,
          animation.duration,
        );
      };

      if (delay) {
        animation.delayTimer = setTimeout(start, delay);
      } else {
        start();
      }
    } else if (animation.onEnd) {
      animation.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    const interpolator = animation.interpolator;
    if (!interpolator) return;

    // Always use the latest duration and easing, so that an active animation
    // adopts new settings as soon as its props change
    const step = animation.duration ? elapsed / animation.duration : 1;
    const ease = d3Ease[formatAnimationName(animation.easing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    if (step >= 1) {
      animation.currentStyle = interpolator(1);
      setState({
        data: animation.currentStyle,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (animation.loopID) {
        timer.unsubscribe(animation.loopID);
        animation.loopID = undefined;
      }
      animation.queue.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    animation.currentStyle = interpolator(ease(step));
    setState({
      data: animation.currentStyle,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
