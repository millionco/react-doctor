// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 48cbf0dca13418ffe7b493cb1c67813db65c319a98328d11c638a93b9de1e703
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
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const generation = React.useRef(0);
  const visibleRef = React.useRef<AnimationStyle>(state.data);
  const unmountedRef = React.useRef(false);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  // Adopt latest props synchronously for in-flight frames
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  React.useEffect(() => {
    visibleRef.current = state.data;
  }, [state.data]);

  const initialDataRef = React.useRef<AnimationData>(data);
  const isFirstDataEffect = React.useRef(true);

  const clearDelayTimeout = React.useCallback(() => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
  }, []);

  const unsubscribeLoop = React.useCallback(() => {
    if (loopID.current !== undefined && loopID.current !== null) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (unmountedRef.current) return;
    if (!queue.current.length) {
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }
    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(visibleRef.current, nextData);
    const genAtStart = generation.current;

    const runFrame = (elapsed: number) => {
      if (unmountedRef.current) return;
      if (generation.current !== genAtStart) return;
      if (!interpolator.current) return;

      const dur = durationRef.current;
      const step = dur ? elapsed / dur : 1;

      if (step >= 1) {
        if (unmountedRef.current) return;
        if (generation.current !== genAtStart) return;
        const finalData = interpolator.current(1);
        visibleRef.current = finalData;
        setState({
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
        traverseQueue();
        return;
      }

      const easeFn =
        d3Ease[formatAnimationName(easingRef.current) as keyof typeof d3Ease];
      const ease = typeof easeFn === "function" ? easeFn : (t: number) => t;
      const current = interpolator.current((ease as any)(step));
      if (unmountedRef.current) return;
      if (generation.current !== genAtStart) return;
      visibleRef.current = current;
      setState({
        data: current,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    };

    if (delayRef.current) {
      delayTimeoutID.current = setTimeout(() => {
        if (unmountedRef.current) return;
        if (generation.current !== genAtStart) return;
        delayTimeoutID.current = undefined;
        loopID.current = timer.subscribe(runFrame, durationRef.current);
      }, delayRef.current);
    } else {
      loopID.current = timer.subscribe(runFrame, durationRef.current);
    }
  }, [timer]);

  // mount / unmount handling
  React.useEffect(() => {
    unmountedRef.current = false;
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      unmountedRef.current = true;
      clearDelayTimeout();
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // data change handling: continue from currently visible style toward new data,
  // without flashing superseded target, and supersede any in-progress run.
  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      // On first effect, if data prop is same reference as initial, skip to avoid double-start
      // If it changed between first render and effect execution, treat as change.
      if (Object.is(data, initialDataRef.current)) {
        return;
      }
    }
    generation.current += 1;
    clearDelayTimeout();
    unsubscribeLoop();
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
