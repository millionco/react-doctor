// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b8478d16e02a207a9578f82e009e4322efaf10b306bae623ed20e399dd51af9c
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
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(Array.isArray(data) ? data.slice(1) : []);
  
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<any>(undefined);

  const propsRef = React.useRef({ duration, easing, onEnd, delay });
  React.useEffect(() => {
    propsRef.current = { duration, easing, onEnd, delay };
  });

  const stopTimer = React.useCallback(() => {
    if (timeoutID.current) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      
      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);
      
      const { delay: currentDelay, duration: currentDuration } = propsRef.current;
      
      if (currentDelay) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          loopID.current = timer.subscribe(functionToBeRunEachFrame, currentDuration);
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(functionToBeRunEachFrame, currentDuration);
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
  }, [timer]);

  const functionToBeRunEachFrame = React.useCallback((elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } = propsRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      stopTimer();
      queue.current.shift();
      traverseQueue();
      return;
    }

    const ease = d3Ease[formatAnimationName(currentEasing)];
    setState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  }, [stopTimer, traverseQueue]);

  const prevData = React.useRef(data);

  React.useEffect(() => {
    if (prevData.current !== data) {
      prevData.current = data;
      stopTimer();
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }
  }, [data, stopTimer, traverseQueue]);

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      const hasLoop = !!loopID.current;
      stopTimer();
      if (!hasLoop) {
        timer.stop();
      }
    };
  }, [stopTimer, traverseQueue, timer]);

  return children(state.data, state.animationInfo);
};
