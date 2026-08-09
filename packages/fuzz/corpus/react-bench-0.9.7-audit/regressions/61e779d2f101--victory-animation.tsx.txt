// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 61e779d2f1019af363640c565c67081d1ff41dfae9522f1eda110fbaee113fa7
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

  const stateRef = React.useRef(state);
  const propsRef = React.useRef({ duration, easing, onEnd, delay });
  React.useEffect(() => {
    propsRef.current = { duration, easing, onEnd, delay };
  }, [duration, easing, onEnd, delay]);

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<any>(undefined);

  const clearTimer = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  }, [timer]);

  const updateState = React.useCallback((newState: Partial<VictoryAnimationState>) => {
    stateRef.current = { ...stateRef.current, ...newState };
    setState(stateRef.current);
  }, []);

  const functionToBeRunEachFrame = React.useCallback((elapsed: number) => {
    if (!interpolator.current) return;
    const { duration, easing } = propsRef.current;
    const ease = d3Ease[formatAnimationName(easing)];

    const step = duration ? elapsed / duration : 1;

    if (step >= 1) {
      updateState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
        },
      });
      clearTimer();
      queue.current.shift();
      traverseQueue();
      return;
    }

    updateState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  }, [clearTimer, updateState]);

  const traverseQueue = React.useCallback(() => {
    clearTimer();
    if (queue.current.length) {
      const nextData = queue.current[0];
      const { duration, delay } = propsRef.current;

      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      if (delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          loopID.current = timer.subscribe(functionToBeRunEachFrame, duration);
        }, delay);
      } else {
        loopID.current = timer.subscribe(functionToBeRunEachFrame, duration);
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
  }, [clearTimer, functionToBeRunEachFrame, timer]);

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      clearTimer();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    // When data changes, start interpolating from current state to the new data
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return children(state.data, state.animationInfo);
};
