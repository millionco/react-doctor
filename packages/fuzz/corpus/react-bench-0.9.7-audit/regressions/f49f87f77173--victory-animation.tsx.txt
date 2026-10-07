// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit f49f87f771736da08084237a9ffcd85edbe9b48b2d30b28cfe09be19402b074d
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

const formatAnimationName = (name: AnimationEasing) =>
  `ease${name.charAt(0).toUpperCase()}${name.slice(1)}`;
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
  const currentData = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const loopID = React.useRef<number | undefined>();
  const delayID = React.useRef<ReturnType<typeof setTimeout>>();
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  onEndRef.current = onEnd;

  const cancelRun = () => {
    runID.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const traverseQueue = (id: number, notifyOnEnd = true) => {
    if (id !== runID.current) return;
    if (!queue.current.length) {
      if (notifyOnEnd) onEndRef.current?.();
      return;
    }
    const interpolator = victoryInterpolator(
      currentData.current,
      queue.current[0],
    );
    const start = () => {
      if (id !== runID.current) return;
      delayID.current = undefined;
      loopID.current = timer.subscribe((elapsed: number) => {
        if (id !== runID.current) return;
        const step = durationRef.current ? elapsed / durationRef.current : 1;
        const ease = d3Ease[formatAnimationName(easingRef.current)];
        if (step >= 1) {
          const finalData = interpolator(1);
          currentData.current = finalData;
          setState({
            data: finalData,
            animationInfo: { progress: 1, animating: false, terminating: true },
          });
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          queue.current.shift();
          traverseQueue(id);
          return;
        }
        const nextStyle = interpolator(ease(step));
        currentData.current = nextStyle;
        setState({
          data: nextStyle,
          animationInfo: { progress: step, animating: true },
        });
      }, durationRef.current);
    };
    if (delay) delayID.current = setTimeout(start, delay);
    else start();
  };

  const startRun = (nextQueue: AnimationStyle[], notifyOnEnd = true) => {
    cancelRun();
    queue.current = nextQueue;
    traverseQueue(runID.current, notifyOnEnd);
  };

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (queue.current.length) traverseQueue(runID.current, false);
      return;
    }
    startRun(Array.isArray(data) ? data : [data]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => cancelRun, [timer]);

  return children(state.data, state.animationInfo);
};
