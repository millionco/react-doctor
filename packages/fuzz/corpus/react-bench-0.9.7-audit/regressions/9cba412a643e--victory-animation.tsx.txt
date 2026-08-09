// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 9cba412a643ed72ea1bf9603d207640903e54f52bc367c84cd23ed206acafd6a
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import isEqual from "react-fast-compare";

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
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = React.useRef(0);
  const mounted = React.useRef(true);
  const stateRef = React.useRef<VictoryAnimationState>(state);
  const lastDataRef = React.useRef<AnimationData>(data);
  const isFirstDataEffect = React.useRef(true);

  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const easeFnRef = React.useRef<(t: number) => number>(
    (d3Ease as any)[formatAnimationName(easing)] ?? ((t: number) => t),
  );

  durationRef.current = duration;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  easeFnRef.current =
    (d3Ease as any)[formatAnimationName(easing)] ?? ((t: number) => t);

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearCurrent = React.useCallback(() => {
    if (loopID.current !== undefined) {
      try {
        timer.unsubscribe(loopID.current);
      } catch {}
      loopID.current = undefined;
    }
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = null;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (!mounted.current) return;
    const genAtEntry = generation.current;
    if (queue.current.length === 0) {
      if (generation.current !== genAtEntry) return;
      if (!mounted.current) return;
      const cb = onEndRef.current;
      if (cb) cb();
      return;
    }

    const nextData = queue.current[0];
    const currentVisible = stateRef.current.data;
    interpolator.current = victoryInterpolator(currentVisible, nextData);
    const gen = generation.current;

    const subscribe = () => {
      if (!mounted.current) return;
      if (generation.current !== gen) return;
      if (loopID.current !== undefined) {
        try {
          timer.unsubscribe(loopID.current);
        } catch {}
        loopID.current = undefined;
      }
      loopID.current = timer.subscribe((elapsed: number) => {
        if (generation.current !== gen) return;
        if (!mounted.current) return;
        if (!interpolator.current) return;

        const dur = durationRef.current;
        const ease = easeFnRef.current;
        const step = dur ? elapsed / dur : 1;

        if (step >= 1) {
          if (generation.current !== gen) return;
          if (!mounted.current) return;
          const finalData = interpolator.current(1);
          const finalState: VictoryAnimationState = {
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          };
          stateRef.current = finalState;
          setState(finalState);
          if (loopID.current !== undefined) {
            try {
              timer.unsubscribe(loopID.current);
            } catch {}
            loopID.current = undefined;
          }
          if (generation.current !== gen) return;
          queue.current.shift();
          traverseQueue();
          return;
        }

        const eased = ease(step);
        const interpolated = interpolator.current(eased);
        const nextState: VictoryAnimationState = {
          data: interpolated,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        };
        stateRef.current = nextState;
        setState(nextState);
      }, durationRef.current);
    };

    const d = delayRef.current;
    if (d) {
      delayTimeout.current = setTimeout(() => {
        delayTimeout.current = null;
        if (generation.current !== gen) return;
        if (!mounted.current) return;
        subscribe();
      }, d);
    } else {
      subscribe();
    }
  }, [timer]);

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      mounted.current = false;
      generation.current += 1;
      clearCurrent();
    };
  }, []); // eslint-disable-line

  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      if (isEqual(lastDataRef.current, data)) {
        return;
      }
    } else if (isEqual(lastDataRef.current, data)) {
      return;
    }
    generation.current += 1;
    clearCurrent();
    lastDataRef.current = data;
    const newQueue = Array.isArray(data) ? [...data] : [data];
    queue.current = newQueue as AnimationStyle[];
    traverseQueue();
  }, [data]); // eslint-disable-line

  return children(state.data, state.animationInfo);
};
