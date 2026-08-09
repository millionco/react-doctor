// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0c68a81712843795283cb457fa45eed33ef72c191f7e76352e35dbc32c43f8bb
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
  const visibleData = React.useRef(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>();
  const runID = React.useRef(0);
  const durationRef = React.useRef(duration);
  const onEndRef = React.useRef(onEnd);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const mounted = React.useRef(false);
  const hasSeenData = React.useRef(false);

  durationRef.current = duration;
  onEndRef.current = onEnd;
  easeRef.current = d3Ease[formatAnimationName(easing)];

  const stop = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(
    (id: number) => {
      if (id !== runID.current || !mounted.current) return;
      if (!queue.current.length) {
        onEndRef.current?.();
        return;
      }
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(visibleData.current, nextData);
      const subscribe = () => {
        if (id === runID.current && mounted.current) {
          loopID.current = timer.subscribe(
            (elapsed) => functionToBeRunEachFrame(elapsed, id),
            durationRef.current,
          );
        }
      };
      if (delay) delayID.current = setTimeout(subscribe, delay);
      else subscribe();
    },
    [delay, timer],
  );

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, id: number) => {
      if (id !== runID.current || !interpolator.current || !mounted.current)
        return;
      const step = durationRef.current ? elapsed / durationRef.current : 1;
      const complete = step >= 1;
      const progress = complete ? 1 : step;
      const next = interpolator.current(
        complete ? 1 : easeRef.current(progress),
      );
      visibleData.current = next;
      setState({
        data: next,
        animationInfo: {
          progress,
          animating: !complete,
          ...(complete ? { terminating: true } : {}),
        },
      });
      if (complete) {
        stop();
        queue.current.shift();
        traverseQueue(id);
      }
    },
    [stop, traverseQueue],
  );

  React.useEffect(() => {
    mounted.current = true;
    traverseQueue(runID.current);
    return () => {
      mounted.current = false;
      runID.current += 1;
      stop();
    };
  }, [stop, traverseQueue]);

  React.useEffect(() => {
    // The initial queue is already initialized from the first render.
    if (!mounted.current) return;
    if (!hasSeenData.current) {
      hasSeenData.current = true;
      return;
    }
    stop();
    runID.current += 1;
    const id = runID.current;
    queue.current = Array.isArray(data) ? data : [data];
    setState({
      data: visibleData.current,
      animationInfo: { progress: 0, animating: true },
    });
    traverseQueue(id);
  }, [data, stop, traverseQueue]);

  return children(state.data, state.animationInfo);
};
