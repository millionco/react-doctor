// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit e5b29f49b65e7398cea78a86d06b46be9c69769fdf501abefb9188743ec0149d
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

  const timer = React.useContext(TimerContext).animationTimer;
  
  const stateRef = React.useRef(state);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };
  
  const isMounted = React.useRef(false);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      if (propsRef.current.delay) {
        timeoutID.current = setTimeout(() => {
          loopID.current = timer.subscribe(functionToBeRunEachFrame, propsRef.current.duration);
        }, propsRef.current.delay);
      } else {
        loopID.current = timer.subscribe(functionToBeRunEachFrame, propsRef.current.duration);
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } = propsRef.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      const newState = {
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      };
      
      stateRef.current = newState;
      setState(newState);
      
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      
      queue.current.shift();
      traverseQueue();
      return;
    }

    const currentData = interpolator.current(ease(step));
    const newState = {
      data: currentData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    };
    
    stateRef.current = newState;
    setState(newState);
  };

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }

    return () => {
      if (timeoutID.current) {
        clearTimeout(timeoutID.current);
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }

    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }

    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
