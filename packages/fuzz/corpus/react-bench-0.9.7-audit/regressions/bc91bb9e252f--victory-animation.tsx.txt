// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit bc91bb9e252fb5f422bc54e18a619c0b06e22aec1dd9b238f12b0a8fae4aafbf
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
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const latestState = React.useRef(state);
  // Ensure latestState is synced during render just in case
  latestState.current = state;

  const propsRef = React.useRef({ duration, easing, delay, onEnd, data });
  propsRef.current = { duration, easing, delay, onEnd, data };

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    // Start traversal on mount if queue is not empty
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (loopID.current) timer.unsubscribe(loopID.current);
      if (delayTimeout.current) clearTimeout(delayTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Cancel existing loop and delay if it exists
    if (loopID.current) timer.unsubscribe(loopID.current);
    if (delayTimeout.current) clearTimeout(delayTimeout.current);
    
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Use latestState to interpolate from currently visible style
      interpolator.current = victoryInterpolator(latestState.current.data, nextData);

      // Reset step to zero
      if (propsRef.current.delay) {
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = undefined;
          loopID.current = timer.subscribe(functionToBeRunEachFrame, propsRef.current.duration ?? DEFAULT_DURATION);
        }, propsRef.current.delay);
      } else {
        loopID.current = timer.subscribe(functionToBeRunEachFrame, propsRef.current.duration ?? DEFAULT_DURATION);
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currentDuration = propsRef.current.duration ?? DEFAULT_DURATION;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalState = {
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      };
      
      latestState.current = finalState;
      setState(finalState);
      
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    const currentEasing = propsRef.current.easing ?? "quadInOut";
    const ease = d3Ease[formatAnimationName(currentEasing)];
    
    const nextState = {
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    };
    
    latestState.current = nextState;
    setState(nextState);
  };

  return children(state.data, state.animationInfo);
};
