// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 3dc24f95366e6113cdd441c53f385b90a8a38d899a9b7e20a224fbc3715e66b4
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

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
  const visibleData = React.useRef<AnimationStyle>(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);
  const didMount = React.useRef(false);

  // Timer callbacks may outlive the render that created them.
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  const cancelRun = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    expectedRun = runID.current,
  ) => {
    if (expectedRun !== runID.current) return;
    if (!interpolator.current) return;
    const step = durationRef.current ? elapsed / durationRef.current : 1;
    const currentInterpolator = interpolator.current;
    if (step >= 1) {
      const finalData = currentInterpolator(1);
      visibleData.current = finalData;
      setState({
        data: finalData,
        animationInfo: { progress: 1, animating: false, terminating: true },
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue();
      return;
    }
    const animatedData = currentInterpolator(easeRef.current(step));
    visibleData.current = animatedData;
    setState({
      data: animatedData,
      animationInfo: { progress: step, animating: step < 1 },
    });
  };

  const traverseQueue = () => {
    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }
    interpolator.current = victoryInterpolator(
      visibleData.current,
      queue.current[0],
    );
    const thisRun = runID.current;
    const start = () => {
      if (thisRun !== runID.current) return;
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, thisRun),
        durationRef.current,
      );
    };
    if (delay) {
      timeoutID.current = setTimeout(() => {
        timeoutID.current = undefined;
        start();
      }, delay);
    } else {
      start();
    }
  };

  React.useEffect(() => {
    if (queue.current.length) traverseQueue();
    return () => {
      runID.current += 1;
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    // Replace the queue and start from the value currently visible. This
    // covers delayed starts, active steps, and queued steps alike.
    runID.current += 1;
    cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
