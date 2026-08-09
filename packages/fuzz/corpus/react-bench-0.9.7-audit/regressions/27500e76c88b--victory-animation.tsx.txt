// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 27500e76c88b9baca1d872d5102cba1abf0f617eb8cc618edbae4c6a86c9cc3b
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

  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const delayTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const runGenerationRef = React.useRef(0);
  const displayedDataRef = React.useRef<AnimationStyle>(state.data);
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const lastDataRef = React.useRef(data);

  // Keep mutable refs in sync with the latest props and state so that the
  // active timer callback always uses the current settings without being
  // trapped in the closure of the render that started it.
  durationRef.current = duration;
  delayRef.current = delay;
  easingRef.current = easing;
  onEndRef.current = onEnd;
  displayedDataRef.current = state.data;

  const getEase = React.useCallback((name: AnimationEasing) => {
    return d3Ease[formatAnimationName(name)];
  }, []);

  const stopCurrentRun = React.useCallback(() => {
    if (loopIDRef.current) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
  }, [timer]);

  const startRun = React.useCallback(() => {
    // Cancel any in-flight run or pending delayed start so that superseded
    // animations cannot render or complete later.
    stopCurrentRun();
    const generation = ++runGenerationRef.current;

    if (!queueRef.current.length) {
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queueRef.current[0];
    interpolatorRef.current = victoryInterpolator(
      displayedDataRef.current,
      nextData,
    );

    const startTimer = () => {
      // If another run has already been requested (e.g. data changed during
      // the delay), do nothing.
      if (generation !== runGenerationRef.current) {
        return;
      }
      delayTimerRef.current = null;
      loopIDRef.current = timer.subscribe((elapsed) => {
        if (generation !== runGenerationRef.current) {
          return;
        }
        const step = durationRef.current ? elapsed / durationRef.current : 1;
        const ease = getEase(easingRef.current);

        if (step >= 1) {
          const finalData = interpolatorRef.current!(1);
          displayedDataRef.current = finalData;
          setState({
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });
          timer.unsubscribe(loopIDRef.current!);
          loopIDRef.current = undefined;
          queueRef.current.shift();
          if (queueRef.current.length) {
            startRun();
          } else if (onEndRef.current) {
            onEndRef.current();
          }
          return;
        }

        setState({
          data: interpolatorRef.current!(ease(step)),
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
      }, durationRef.current);
    };

    if (delayRef.current) {
      delayTimerRef.current = setTimeout(startTimer, delayRef.current);
    } else {
      startTimer();
    }
  }, [timer, stopCurrentRun, getEase]);

  React.useLayoutEffect(() => {
    if (data !== lastDataRef.current) {
      // The data target changed mid-run. Replace the queue with the latest data
      // and animate from the currently visible style to the new target so the
      // superseded target is never rendered at completion.
      queueRef.current = Array.isArray(data) ? data : [data];
      startRun();
    } else {
      // Initial mount: show the first datum immediately and queue the rest.
      queueRef.current = Array.isArray(data) ? data.slice(1) : [];
      if (queueRef.current.length) {
        startRun();
      }
    }
    return () => stopCurrentRun();
  }, [data, startRun, stopCurrentRun]);

  return children(state.data, state.animationInfo);
};
