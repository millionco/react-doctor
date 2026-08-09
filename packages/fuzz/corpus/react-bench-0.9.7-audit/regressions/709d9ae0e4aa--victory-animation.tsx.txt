// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 709d9ae0e4aa859a870813b36668edc4415e1330db57f6f6265aa14be3ae0ac5
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
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);

  React.useEffect(() => {
    durationRef.current = duration;
    easingRef.current = easing;
    onEndRef.current = onEnd;
    delayRef.current = delay;
  });

  const [state, setState] = React.useState<VictoryAnimationState>(() => {
    const initialStyle = Array.isArray(data) ? data[0] : data;
    return {
      data: initialStyle,
      animationInfo: {
        progress: 0,
        animating: false,
      },
    };
  });

  const currentStyleRef = React.useRef<AnimationStyle>(state.data);

  const updateState = (nextStyle: AnimationStyle, info: AnimationInfo) => {
    currentStyleRef.current = nextStyle;
    setState({
      data: nextStyle,
      animationInfo: info,
    });
  };

  const timer = React.useContext(TimerContext).animationTimer;

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const activeRunID = React.useRef(0);

  const stopCurrentRun = () => {
    if (delayTimeoutID.current) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const startAnimation = (runID: number) => {
    if (activeRunID.current !== runID) return;

    if (queue.current.length === 0) {
      const currentOnEnd = onEndRef.current;
      if (currentOnEnd) {
        currentOnEnd();
      }
      return;
    }

    const nextData = queue.current[0];
    const startStyle = currentStyleRef.current;
    interpolator.current = victoryInterpolator(startStyle, nextData);

    const functionToBeRunEachFrame = (elapsed: number) => {
      if (activeRunID.current !== runID) {
        return;
      }
      if (!interpolator.current) return;

      const currentDuration = durationRef.current;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalStyle = interpolator.current(1);
        updateState(finalStyle, {
          progress: 1,
          animating: false,
          terminating: true,
        });

        stopCurrentRun();

        queue.current.shift();
        startAnimation(runID);
        return;
      }

      const currentEasing = easingRef.current;
      const ease =
        d3Ease[formatAnimationName(currentEasing)] || d3Ease.easeQuadInOut;
      const easedStep = ease(step);

      const nextStyle = interpolator.current(easedStep);
      updateState(nextStyle, {
        progress: step,
        animating: true,
      });
    };

    const currentDuration = durationRef.current;
    const currentDelay = delayRef.current;

    if (currentDelay) {
      delayTimeoutID.current = setTimeout(() => {
        if (activeRunID.current !== runID) return;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      }, currentDelay);
    } else {
      loopID.current = timer.subscribe(
        functionToBeRunEachFrame,
        currentDuration,
      );
    }
  };

  // Mount/Initial sequence
  React.useEffect(() => {
    if (Array.isArray(data) && data.length > 1) {
      queue.current = data.slice(1);
      activeRunID.current += 1;
      startAnimation(activeRunID.current);
    }

    return () => {
      activeRunID.current = -1; // invalidate
      stopCurrentRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle data prop updates
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    stopCurrentRun();

    queue.current = Array.isArray(data) ? data : [data];

    activeRunID.current += 1;
    startAnimation(activeRunID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
