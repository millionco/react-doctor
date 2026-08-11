// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit dc33a0f10500d9521c8990743550cec9ae4cd119d6579e81d3751f8220e47abc
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
  const dataRef = React.useRef(data);
  const displayedData = React.useRef(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);

  // These values are deliberately kept outside the animation callbacks. A
  // timer callback may outlive the render that created it, but it must always
  // use the current animation configuration.
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    displayedData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const cancelAnimation = () => {
    // Incrementing this also makes an already-queued timer callback harmless.
    runID.current++;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const traverseQueue = (currentRunID: number) => {
    if (currentRunID !== runID.current) return;

    const nextData = queue.current[0];
    if (!nextData) {
      interpolator.current = null;
      onEndRef.current?.();
      return;
    }

    interpolator.current = victoryInterpolator(displayedData.current, nextData);

    const start = () => {
      if (currentRunID !== runID.current) return;

      setAnimationState(displayedData.current, {
        progress: 0,
        animating: true,
      });

      loopID.current = timer.subscribe((elapsed) => {
        if (currentRunID !== runID.current || !interpolator.current) return;

        // Duration and easing may change while this subscription is active.
        const currentDuration = durationRef.current;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const completedData = interpolator.current(1);
          setAnimationState(completedData, {
            progress: 1,
            animating: false,
            terminating: true,
          });
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          queue.current.shift();
          traverseQueue(currentRunID);
          return;
        }

        setAnimationState(interpolator.current(easeRef.current(step)), {
          progress: step,
          animating: true,
        });
      }, durationRef.current);
    };

    if (delay) {
      delayID.current = setTimeout(() => {
        delayID.current = undefined;
        start();
      }, delay);
    } else {
      start();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      runID.current++;
      traverseQueue(runID.current);
    }

    // Clean up the animation loop
    return () => {
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The first value is already rendered. Subsequent values replace any
    // active or delayed run, beginning at the style currently on screen.
    if (dataRef.current === data) return;
    dataRef.current = data;
    cancelAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    const currentRunID = runID.current;
    traverseQueue(currentRunID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
