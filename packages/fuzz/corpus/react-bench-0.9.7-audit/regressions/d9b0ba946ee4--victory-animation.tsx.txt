// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d9b0ba946ee49e3c75c734c6c7ab05fdedfd1d74de0e52712869f2a1adc35223
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

  // Refs for tracking latest prop values
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

  // Track the current visible style (the latest style rendered or calculated)
  const visibleStyleRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data
  );

  // Track the current queue and animation loop IDs
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null
  );

  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Run ID to safely invalidate older runs
  const runID = React.useRef(0);
  const isFirstRender = React.useRef(true);

  const traverseQueue = (currentRunID: number) => {
    if (currentRunID !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from currently visible style to next target
      interpolator.current = victoryInterpolator(visibleStyleRef.current, nextData);

      const runFrame = (elapsed: number) => {
        if (currentRunID !== runID.current) {
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          return;
        }

        if (!interpolator.current) return;

        const currentDuration = durationRef.current;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalStyle = interpolator.current(1);
          visibleStyleRef.current = finalStyle;

          setState({
            data: finalStyle,
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

        const easeName = formatAnimationName(easingRef.current);
        const easeFn = d3Ease[easeName] || d3Ease.easeQuadInOut;
        const currentStyle = interpolator.current(easeFn(step));
        visibleStyleRef.current = currentStyle;

        setState({
          data: currentStyle,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      };

      const currentDelay = delayRef.current;
      if (currentDelay) {
        timeoutID.current = setTimeout(() => {
          if (currentRunID !== runID.current) return;
          loopID.current = timer.subscribe(runFrame, durationRef.current);
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(runFrame, durationRef.current);
      }
    } else {
      if (onEndRef.current) {
        onEndRef.current();
      }
    }
  };

  // On mount/update of data
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      if (queue.current.length) {
        traverseQueue(runID.current);
      }
      return;
    }

    runID.current += 1;
    const currentRunID = runID.current;

    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }

    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(currentRunID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      runID.current += 1;
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
