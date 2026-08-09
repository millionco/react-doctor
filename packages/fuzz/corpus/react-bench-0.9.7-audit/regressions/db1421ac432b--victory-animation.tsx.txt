// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit db1421ac432bb84c9961d499b0afb904bfe03bc419bacbe16c9fa4d921021674
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import isEqual from "react-fast-compare";

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
  const timer = React.useContext(TimerContext).animationTimer;

  // Initialize state based on data prop
  const [state, setState] = React.useState<VictoryAnimationState>(() => {
    const initialData = Array.isArray(data) ? data[0] : data;
    return {
      data: initialData,
      animationInfo: {
        progress: 0,
        animating: false,
      },
    };
  });

  // Track state and latest props using refs to avoid stale closures
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const currentStyleRef = React.useRef<AnimationStyle>(state.data);

  const latestProps = React.useRef({ duration, easing, delay, onEnd, data });
  latestProps.current = { duration, easing, delay, onEnd, data };

  // Keep track of the queue and timer loops
  const queueRef = React.useRef<AnimationStyle[]>([]);
  const interpolatorRef = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopIdRef = React.useRef<number | undefined>(undefined);
  const timeoutIdRef = React.useRef<any>(undefined);

  const cancelActiveAnimation = () => {
    if (timeoutIdRef.current !== undefined) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = undefined;
    }
    if (loopIdRef.current !== undefined) {
      timer.unsubscribe(loopIdRef.current);
      loopIdRef.current = undefined;
    }
  };

  const updateState = (newData: AnimationStyle, info: AnimationInfo) => {
    currentStyleRef.current = newData;
    setState({
      data: newData,
      animationInfo: info,
    });
  };

  const traverseQueue = () => {
    if (queueRef.current.length > 0) {
      const nextData = queueRef.current[0];
      const startData = currentStyleRef.current;

      interpolatorRef.current = victoryInterpolator(startData, nextData);

      const runStep = () => {
        loopIdRef.current = timer.subscribe((elapsed: number) => {
          const currentDuration = latestProps.current.duration;
          const currentEasing = latestProps.current.easing;
          const easeFn = d3Ease[formatAnimationName(currentEasing)] || d3Ease.easeQuadInOut;

          const step = currentDuration ? elapsed / currentDuration : 1;

          if (step >= 1) {
            cancelActiveAnimation();

            const finalData = interpolatorRef.current ? interpolatorRef.current(1) : nextData;
            updateState(finalData, {
              progress: 1,
              animating: false,
              terminating: true,
            });

            queueRef.current.shift();
            traverseQueue();
          } else {
            const interpolatedData = interpolatorRef.current ? interpolatorRef.current(easeFn(step)) : startData;
            updateState(interpolatedData, {
              progress: step,
              animating: true,
            });
          }
        }, latestProps.current.duration);
      };

      const delayVal = latestProps.current.delay;
      if (delayVal) {
        timeoutIdRef.current = setTimeout(() => {
          timeoutIdRef.current = undefined;
          runStep();
        }, delayVal);
      } else {
        runStep();
      }
    } else {
      if (latestProps.current.onEnd) {
        latestProps.current.onEnd();
      }
    }
  };

  const prevDataRef = React.useRef<AnimationData | undefined>(undefined);

  // Handle mounting and updates on data change
  React.useEffect(() => {
    const isInitialMount = prevDataRef.current === undefined;
    if (isInitialMount) {
      prevDataRef.current = data;
      if (Array.isArray(data) && data.length > 1) {
        queueRef.current = data.slice(1);
        traverseQueue();
      }
    } else {
      if (!isEqual(prevDataRef.current, data)) {
        prevDataRef.current = data;
        cancelActiveAnimation();
        queueRef.current = Array.isArray(data) ? [...data] : [data];
        traverseQueue();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Handle unmounting only
  React.useEffect(() => {
    return () => {
      cancelActiveAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
