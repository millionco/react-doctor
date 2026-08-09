// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 86c8106a7a4b3c5507ce38d6b2376c6ee4a67fe68e3e507a0339dbd542251219
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

interface AnimationStep {
  runID: number;
  stepID: number;
  interpolator: (value: number) => AnimationStyle;
  nextData: AnimationStyle;
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
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const stepID = React.useRef(0);
  const mounted = React.useRef(false);
  const hasRun = React.useRef(false);
  const previousData = React.useRef(data);
  const renderedData = React.useRef(state.data);

  // Animation callbacks may outlive the render that created them. Keep the
  // mutable animation options current without restarting the active tween.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  renderedData.current = state.data;

  React.useEffect(() => {
    mounted.current = true;

    const isInitialRun = !hasRun.current || previousData.current === data;
    hasRun.current = true;
    previousData.current = data;

    // The first item in an initial array is the initially visible style.
    // Replacement arrays, however, are traversed in full from the style that
    // is currently on screen.
    if (Array.isArray(data)) {
      queue.current = data.slice(isInitialRun ? 1 : 0);
    } else {
      queue.current = isInitialRun ? [] : [data];
    }

    const currentRun = ++runID.current;
    if (queue.current.length) {
      traverseQueue(currentRun, renderedData.current);
    }

    return () => {
      mounted.current = false;
      runID.current++;
      stepID.current++;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (currentRun: number, fromData: AnimationStyle) => {
    if (
      !mounted.current ||
      currentRun !== runID.current ||
      !queue.current.length
    ) {
      return;
    }

    const nextData = queue.current[0];
    const currentStep = ++stepID.current;
    const interpolator = victoryInterpolator(fromData, nextData);
    const animationStep = {
      runID: currentRun,
      stepID: currentStep,
      interpolator,
      nextData,
    };
    const start = () => {
      delayID.current = undefined;
      if (
        !mounted.current ||
        currentRun !== runID.current ||
        currentStep !== stepID.current
      ) {
        return;
      }
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, animationStep),
        durationRef.current,
      );
    };

    if (delayRef.current) {
      delayID.current = setTimeout(start, delayRef.current);
    } else {
      start();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    animationStep: AnimationStep,
  ) => {
    const {
      runID: currentRun,
      stepID: currentStep,
      interpolator,
      nextData,
    } = animationStep;
    if (
      !mounted.current ||
      currentRun !== runID.current ||
      currentStep !== stepID.current
    ) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setState({
        data: interpolator(1),
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
      if (queue.current.length) {
        traverseQueue(currentRun, nextData);
      } else {
        stepID.current++;
        onEndRef.current?.();
      }
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setState({
      data: interpolator(d3Ease[formatAnimationName(easingRef.current)](step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
