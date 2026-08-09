// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2a3f9dde0c8a49663d0546ed3fff6144f69b834451c30f148ba756dc1ff160d3
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
  // The style currently on screen. New runs interpolate from this value so a
  // superseded animation hands off without flashing its old target.
  const visibleStyle = React.useRef<AnimationStyle>(state.data);

  // Latest animation settings, read by the timer loop so an in-flight
  // animation always uses the most recent props.
  const ease = d3Ease[formatAnimationName(easing)];
  const settings = React.useRef({ duration, delay, onEnd, ease });
  settings.current = { duration, delay, onEnd, ease };

  const setVisibleState = (
    newData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleStyle.current = newData;
    setState({ data: newData, animationInfo });
  };

  const stopAnimation = () => {
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
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from whatever is currently rendered to the next target
      interpolator.current = victoryInterpolator(
        visibleStyle.current,
        nextData,
      );

      const begin = () => {
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          settings.current.duration,
        );
      };
      if (settings.current.delay) {
        delayID.current = setTimeout(begin, settings.current.delay);
      } else {
        begin();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    subscriptionDuration?: number,
  ) => {
    if (!interpolator.current) return;

    // A bypassed timer subscribes with duration 0 to complete immediately;
    // otherwise use the latest duration prop
    const activeDuration =
      subscriptionDuration === 0 ? 0 : settings.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      setVisibleState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      stopAnimation();
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setVisibleState(interpolator.current(settings.current.ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousData = React.useRef(data);
  React.useEffect(() => {
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Supersede any in-flight animation: cancel its timer and pending delayed
    // start so it can never render or complete, then run toward the new data
    // from the currently visible style.
    stopAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
