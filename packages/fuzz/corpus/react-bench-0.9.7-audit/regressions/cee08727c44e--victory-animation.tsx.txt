// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit cee08727c44e7160a8a6fbadb43c93ae635ebd542273462a27a0b721be7b63d4
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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
  // The style most recently handed to `children`. New runs interpolate from
  // here so a mid-animation data change continues from what is visible.
  const currentStyle = React.useRef<AnimationStyle>(state.data);
  // Identifies the active run. Bumped whenever a run is superseded so timer
  // and delay callbacks belonging to an old run can neither render nor
  // complete after the fact.
  const runToken = React.useRef(0);

  // Timer and delay callbacks outlive the render that created them, so they
  // read the animation settings through this ref to pick up prop changes
  // mid-run.
  const settings = React.useRef({ duration, easing, delay, onEnd });
  React.useEffect(() => {
    settings.current = { duration, easing, delay, onEnd };
  });

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentStyle.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const subscribeFrameLoop = () => {
    const token = runToken.current;
    loopID.current = timer.subscribe(
      (elapsed, subscribedDuration) =>
        functionToBeRunEachFrame(token, elapsed, subscribedDuration),
      settings.current.duration,
    );
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently rendered style to the next data
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      // Reset step to zero
      if (settings.current.delay) {
        const token = runToken.current;
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          if (token !== runToken.current) {
            return;
          }
          subscribeFrameLoop();
        }, settings.current.delay);
      } else {
        subscribeFrameLoop();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    token: number,
    elapsed: number,
    subscribedDuration?: number,
  ) => {
    // Ignore frames from a run that has been superseded by a data change
    if (token !== runToken.current || !interpolator.current) {
      return;
    }

    // A subscribed duration of 0 means the timer is bypassing animation;
    // otherwise use the latest duration prop
    const currentDuration =
      subscribedDuration === 0 ? 0 : settings.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

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
      traverseQueue();
      return;
    }

    const ease = d3Ease[formatAnimationName(settings.current.easing)];

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState(interpolator.current(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const previousData = React.useRef(data);

  React.useEffect(() => {
    // On mount this effect sees the initial data, which is not a change.
    // A new reference with equivalent data is not a change either.
    if (isEqual(data, previousData.current)) {
      return;
    }
    previousData.current = data;

    // The data changed mid-run. Supersede the active run so it can no longer
    // render or complete, then start a replacement run from the currently
    // visible style toward the new data.
    runToken.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    // Cancel existing loop if it exists
    timer.unsubscribe(loopID.current);
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      runToken.current += 1;
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
