// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6667cb8c2a1e748ddddc16c46f28b10eec004ae21460aafc7bb5b6e2ac3b0bb0
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

  const timer = React.useContext(TimerContext).animationTimer;

  const currentStyleRef = React.useRef<AnimationStyle>(state.data);
  const queueRef = React.useRef<AnimationStyle[]>([]);
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const runIDRef = React.useRef<number>(0);
  const isMountedRef = React.useRef(false);

  // Keep currentStyleRef in sync with state
  currentStyleRef.current = state.data;

  // Track props in refs to avoid stale closures in active animations
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easingRef.current = easing;
  onEndRef.current = onEnd;

  const startNextStep = (runID: number) => {
    if (runID !== runIDRef.current) return;

    if (queueRef.current.length > 0) {
      const nextTarget = queueRef.current[0];
      const startStyle = currentStyleRef.current;

      interpolatorRef.current = victoryInterpolator(startStyle, nextTarget);

      const stepDuration = durationRef.current ?? DEFAULT_DURATION;
      const stepDelay = delay;

      const callback = (elapsed: number) => {
        if (runID !== runIDRef.current) return;

        const currentDuration = durationRef.current ?? DEFAULT_DURATION;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          if (loopIDRef.current !== undefined) {
            timer.unsubscribe(loopIDRef.current);
            loopIDRef.current = undefined;
          }

          queueRef.current.shift();

          const finalStyle = interpolatorRef.current
            ? interpolatorRef.current(1)
            : nextTarget;
          currentStyleRef.current = finalStyle;

          setState({
            data: finalStyle,
            animationInfo: {
              progress: 1,
              animating: queueRef.current.length > 0,
            },
          });

          startNextStep(runID);
          return;
        }

        const currentEase =
          d3Ease[formatAnimationName(easingRef.current ?? "quadInOut")];
        const interpolatedStyle = interpolatorRef.current
          ? interpolatorRef.current(currentEase(step))
          : startStyle;
        currentStyleRef.current = interpolatedStyle;

        setState({
          data: interpolatedStyle,
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
      };

      if (stepDelay) {
        delayTimeoutRef.current = setTimeout(() => {
          if (runID !== runIDRef.current) return;
          loopIDRef.current = timer.subscribe(callback, stepDuration);
        }, stepDelay);
      } else {
        loopIDRef.current = timer.subscribe(callback, stepDuration);
      }
    } else {
      setState((prev) => ({
        ...prev,
        animationInfo: {
          progress: 1,
          animating: false,
        },
      }));
      if (onEndRef.current) {
        onEndRef.current();
      }
    }
  };

  React.useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      if (Array.isArray(data)) {
        queueRef.current = data.slice(1);
        if (queueRef.current.length > 0) {
          startNextStep(++runIDRef.current);
        }
      }
    } else {
      const currentRunID = ++runIDRef.current;
      if (delayTimeoutRef.current) {
        clearTimeout(delayTimeoutRef.current);
        delayTimeoutRef.current = undefined;
      }
      if (loopIDRef.current !== undefined) {
        timer.unsubscribe(loopIDRef.current);
        loopIDRef.current = undefined;
      }

      queueRef.current = Array.isArray(data) ? [...data] : [data];
      startNextStep(currentRunID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    return () => {
      runIDRef.current = -1;
      if (delayTimeoutRef.current) {
        clearTimeout(delayTimeoutRef.current);
        delayTimeoutRef.current = undefined;
      }
      if (loopIDRef.current !== undefined) {
        timer.unsubscribe(loopIDRef.current);
        loopIDRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
