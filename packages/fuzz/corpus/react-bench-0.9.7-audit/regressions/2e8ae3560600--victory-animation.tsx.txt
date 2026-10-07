// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2e8ae3560600d6fde867096e85b20e61cfeb1a50a592ac75493487120b351ef1
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
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isFirstRender = React.useRef(true);
  const ease = d3Ease[formatAnimationName(easing)];

  // The timer invokes the same frame callback for the lifetime of a
  // subscription, so it must read the latest props through a ref rather than
  // closing over the values from the render in which it was created.
  const latest = React.useRef({ duration, ease, delay, onEnd });
  latest.current = { duration, ease, delay, onEnd };

  // The style currently on screen. Kept in a ref so a new animation can pick
  // up exactly where the previous one left off, even from within stale
  // closures like the timer's frame callback.
  const currentStyle = React.useRef(state.data);

  const setAnimationState = (newState: VictoryAnimationState) => {
    currentStyle.current = newState.data;
    setState(newState);
  };

  const stopAnimation = () => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    timer.unsubscribe(loopID.current);
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The mount effect above is responsible for starting the initial
    // animation queue; this effect only handles subsequent changes to `data`.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Cancel the in-progress animation, if any, so a superseded run can never
    // render or complete after new data arrives
    stopAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue from the currently visible style
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      // Reset step to zero
      if (latest.current.delay) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            latest.current.duration,
          );
        }, latest.current.delay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          latest.current.duration,
        );
      }
    } else if (latest.current.onEnd) {
      latest.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = latest.current.duration
      ? elapsed / latest.current.duration
      : 1;

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
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState({
      data: interpolator.current(latest.current.ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
