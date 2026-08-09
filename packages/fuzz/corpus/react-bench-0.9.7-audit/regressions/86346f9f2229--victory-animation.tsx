// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 86346f9f22298f78464e91c1725b30479c13a37d8078922efa64d88e9037f398
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

export type AnimationStyle = { [key: string]: string | number };
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

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  React.useEffect(() => { durationRef.current = duration; }, [duration]);
  React.useEffect(() => { easingRef.current = easing; }, [easing]);
  React.useEffect(() => { delayRef.current = delay; }, [delay]);
  React.useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);

  const stateRef = React.useRef(state);
  React.useEffect(() => { stateRef.current = state; }, [state]);

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((v: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = React.useRef(0);
  const isFirstData = React.useRef(true);

  const clearDelayTimeout = React.useCallback(() => {
    if (delayTimeout.current !== null) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = null;
    }
  }, []);

  const cancelLoop = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback((gen: number) => {
    if (gen !== generation.current) return;
    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      const run = () => {
        if (gen !== generation.current) return;
        delayTimeout.current = null;
        const frame = (elapsed: number) => {
          if (gen !== generation.current) return;
          if (!interpolator.current) return;
          const dur = durationRef.current;
          const easeName = easingRef.current;
          const easeFn = (d3Ease as any)[formatAnimationName(easeName)] || ((t: number) => t);
          const step = dur ? elapsed / dur : 1;
          if (step >= 1) {
            if (gen !== generation.current) return;
            const finalData = interpolator.current(1);
            const ns: VictoryAnimationState = {
              data: finalData,
              animationInfo: { progress: 1, animating: false, terminating: true },
            };
            stateRef.current = ns;
            setState(ns);
            cancelLoop();
            queue.current.shift();
            traverseQueue(gen);
            return;
          }
          const eased = easeFn(step);
          const cur = interpolator.current(eased);
          const ns: VictoryAnimationState = {
            data: cur,
            animationInfo: { progress: step, animating: step < 1 },
          };
          stateRef.current = ns;
          setState(ns);
        };
        loopID.current = timer.subscribe(frame as any, durationRef.current);
      };

      const d = delayRef.current;
      if (d) {
        clearDelayTimeout();
        delayTimeout.current = setTimeout(run, d);
      } else {
        run();
      }
    } else {
      if (onEndRef.current) onEndRef.current();
    }
  }, [timer, cancelLoop, clearDelayTimeout]);

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue(generation.current);
    }
    return () => {
      generation.current += 1;
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

  React.useEffect(() => {
    if (isFirstData.current) {
      isFirstData.current = false;
      return;
    }
    generation.current += 1;
    clearDelayTimeout();
    cancelLoop();

    if (Array.isArray(data)) {
      queue.current = data.slice();
    } else {
      queue.current = [data];
    }
    traverseQueue(generation.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
