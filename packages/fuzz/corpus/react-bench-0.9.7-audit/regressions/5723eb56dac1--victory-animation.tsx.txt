// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5723eb56dac1300213129a2dc2f423170877c4d2c1dec83026bf984aae511e79
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

const getInitialQueue = (data: AnimationData) => {
  if (!Array.isArray(data)) {
    return [data];
  }

  return data.length === 1 ? [...data] : data.slice(1);
};

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
  const queue = React.useRef<AnimationStyle[]>(getInitialQueue(data));
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const activeData = React.useRef(data);
  const latestData = React.useRef(data);
  const stateRef = React.useRef(state);
  const latest = React.useRef({ duration, easing, delay, onEnd });

  // Frame callbacks intentionally read these values from a ref. Re-subscribing
  // for timing-only prop changes would reset the timer and make the animation
  // take longer than the requested duration.
  latest.current = { duration, easing, delay, onEnd };
  latestData.current = data;

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

  const renderState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    if (mounted.current) {
      setState(nextState);
    }
  };

  const traverseQueue = (currentRunID: number) => {
    if (!mounted.current || currentRunID !== runID.current) {
      return;
    }

    if (!queue.current.length) {
      interpolator.current = null;
      latest.current.onEnd?.();
      return;
    }

    interpolator.current = victoryInterpolator(
      stateRef.current.data,
      queue.current[0],
    );

    const start = () => {
      delayID.current = undefined;
      if (
        !mounted.current ||
        currentRunID !== runID.current ||
        activeData.current !== latestData.current
      ) {
        return;
      }

      loopID.current = timer.subscribe(
        (elapsed: number, timerDuration: number) => {
          if (
            !mounted.current ||
            currentRunID !== runID.current ||
            activeData.current !== latestData.current ||
            !interpolator.current
          ) {
            return;
          }

          const currentDuration =
            timerDuration === 0 ? 0 : latest.current.duration;
          const step = currentDuration ? elapsed / currentDuration : 1;

          if (step >= 1) {
            const finalData = interpolator.current(1);
            renderState({
              data: finalData,
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
            traverseQueue(currentRunID);
            return;
          }

          const ease = d3Ease[formatAnimationName(latest.current.easing)];
          renderState({
            data: interpolator.current(ease(step)),
            animationInfo: {
              progress: step,
              animating: true,
            },
          });
        },
        latest.current.duration,
      );
    };

    if (latest.current.delay) {
      delayID.current = setTimeout(start, latest.current.delay);
    } else {
      start();
    }
  };

  const replaceQueue = (nextData: AnimationData) => {
    cancelRun();
    activeData.current = nextData;
    queue.current = Array.isArray(nextData) ? [...nextData] : [nextData];
    traverseQueue(runID.current);
  };

  React.useEffect(() => {
    mounted.current = true;

    // An empty initial array has no animation to traverse.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    return () => {
      mounted.current = false;
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current === data) {
      return;
    }

    previousData.current = data;
    replaceQueue(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
