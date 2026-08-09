// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit af6a000194ec56c9cc895e702313cf720f408c8b9675a6ecad0a89f1ab6c614c
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

/** Single animation object to interpolate */
export type AnimationStyle = { [key: string]: string | number };
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
    animationInfo: { progress: 0, animating: false },
  });
  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const currentData = React.useRef(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>();
  const runID = React.useRef(0);
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  const cancelRun = () => {
    runID.current += 1;
    timer.unsubscribe(loopID.current);
    loopID.current = undefined;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, id: number) => {
    if (id !== runID.current || !interpolator.current) return;
    const step = durationRef.current ? elapsed / durationRef.current : 1;
    const completed = step >= 1;
    const progress = completed ? 1 : step;
    const nextData = interpolator.current(
      completed ? 1 : easeRef.current(progress),
    );
    currentData.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress,
        animating: !completed,
        ...(completed ? { terminating: true } : {}),
      },
    });
    if (completed) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
      queue.current.shift();
      traverseQueue(id);
    }
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;
    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }
    interpolator.current = victoryInterpolator(
      currentData.current,
      queue.current[0],
    );
    const start = () => {
      if (id !== runID.current) return;
      delayID.current = undefined;
      loopID.current = timer.subscribe(
        (elapsed: number) => functionToBeRunEachFrame(elapsed, id),
        durationRef.current,
      );
    };
    if (delay) delayID.current = setTimeout(start, delay);
    else start();
  };

  React.useEffect(() => {
    if (queue.current.length) traverseQueue(runID.current);
    return cancelRun;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    if (queue.current.length) {
      cancelRun();
      traverseQueue(runID.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, easing]);

  return children(state.data, state.animationInfo);
};
