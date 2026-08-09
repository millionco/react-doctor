// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d0e8f24dd94182e891f38dbde0e178791c179740db46cea5a0c1cb0d8aa1b996
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
  | "back" | "backIn" | "backOut" | "backInOut"
  | "bounce" | "bounceIn" | "bounceOut" | "bounceInOut"
  | "circle" | "circleIn" | "circleOut" | "circleInOut"
  | "linear" | "linearIn" | "linearOut" | "linearInOut"
  | "cubic" | "cubicIn" | "cubicOut" | "cubicInOut"
  | "elastic" | "elasticIn" | "elasticOut" | "elasticInOut"
  | "exp" | "expIn" | "expOut" | "expInOut"
  | "poly" | "polyIn" | "polyOut" | "polyInOut"
  | "quad" | "quadIn" | "quadOut" | "quadInOut"
  | "sin" | "sinIn" | "sinOut" | "sinInOut";

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

export const VictoryAnimation = (props: VictoryAnimationProps) => {
  const { children, data } = props;
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: { progress: 0, animating: false },
  });
  const timer = React.useContext(TimerContext).animationTimer;
  const propsRef = React.useRef(props);
  const dataRef = React.useRef(data);
  const visibleData = React.useRef(initialData);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const loopID = React.useRef<number | undefined>();
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>();
  const runID = React.useRef(0);
  const mounted = React.useRef(true);
  const startNextRef = React.useRef<() => void>(() => undefined);

  propsRef.current = props;

  const cancelRun = React.useCallback(() => {
    runID.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  }, [timer]);

  const setVisibleState = React.useCallback((next: VictoryAnimationState) => {
    visibleData.current = next.data;
    if (mounted.current) setState(next);
  }, []);

  const startNext = React.useCallback(() => {
    if (!mounted.current) return;
    const target = queue.current[0];
    if (!target) {
      propsRef.current.onEnd?.();
      return;
    }

    const interpolator = victoryInterpolator(visibleData.current, target);
    const id = runID.current;
    const run = (elapsed: number) => {
      if (!mounted.current || id !== runID.current) return;
      const { duration = DEFAULT_DURATION, easing = "quadInOut" } = propsRef.current;
      const step = duration ? elapsed / duration : 1;

      if (step >= 1) {
        setVisibleState({
          data: interpolator(1),
          animationInfo: { progress: 1, animating: false, terminating: true },
        });
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        queue.current.shift();
        startNextRef.current();
        return;
      }

      const ease = d3Ease[formatAnimationName(easing)];
      setVisibleState({
        data: interpolator(ease(step)),
        animationInfo: { progress: step, animating: true },
      });
    };

    const subscribe = () => {
      if (mounted.current && id === runID.current) {
        delayID.current = undefined;
        loopID.current = timer.subscribe(run, propsRef.current.duration ?? DEFAULT_DURATION);
      }
    };
    const delay = propsRef.current.delay ?? 0;
    if (delay) {
      delayID.current = setTimeout(subscribe, delay);
    } else {
      subscribe();
    }
  }, [setVisibleState, timer]);
  startNextRef.current = startNext;

  // Begin any initial array queue, and make delayed starts safe to unmount.
  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) startNext();
    return () => {
      mounted.current = false;
      cancelRun();
    };
  }, [cancelRun, startNext]);

  // A data change replaces every pending step. Never complete or render the
  // superseded target: the replacement interpolates from what is visible now.
  React.useEffect(() => {
    if (dataRef.current === data) return;
    dataRef.current = data;
    cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    startNext();
  }, [cancelRun, data, startNext]);

  // Settings are read for every frame. Restarting the active/pending step makes
  // duration and delay changes take effect immediately while retaining its queue.
  const settings = [props.duration, props.easing, props.delay] as const;
  const previousSettings = React.useRef(settings);
  React.useEffect(() => {
    const changed = previousSettings.current.some((value, index) => value !== settings[index]);
    previousSettings.current = settings;
    if (!changed || !queue.current.length) return;
    cancelRun();
    startNext();
  }, [cancelRun, settings, startNext]);

  return children(state.data, state.animationInfo);
};
