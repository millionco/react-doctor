// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 9b0a4832e5204c3c4e50f7c71df59a112dbd4ab19fe726b0672911b44dac0cd2
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const latestProps = React.useRef({ duration, easing, onEnd, delay });
  latestProps.current = { duration, easing, onEnd, delay };

  const currentData = React.useRef<AnimationStyle>(initialData);
  const currentRunId = React.useRef(0);
  const isMounted = React.useRef(false);
  const lastData = React.useRef(data);

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<any | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      currentRunId.current += 1;
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
        timeoutID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isMounted.current && isEqual(lastData.current, data)) {
      return;
    }
    lastData.current = data;

    currentRunId.current += 1;
    const runId = currentRunId.current;

    // Cancel existing loop and timeout if they exist
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }

    if (!isMounted.current) {
      isMounted.current = true;
      // On initial mount: if data is an array, start queue from data[1] onwards
      const initialQueue = Array.isArray(data) ? data.slice(1) : [];
      queue.current = initialQueue;
      if (initialQueue.length > 0) {
        traverseQueue(runId);
      }
    } else {
      // On subsequent data changes:
      // Continue from currentData.current to the new data
      const newQueue = Array.isArray(data) ? [...data] : [data];
      queue.current = newQueue;
      traverseQueue(runId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (runId: number) => {
    if (runId !== currentRunId.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const runEachFrame = (elapsed: number) => {
        functionToBeRunEachFrame(elapsed, runId);
      };

      const activeDelay = latestProps.current.delay;
      if (activeDelay) {
        timeoutID.current = setTimeout(() => {
          if (runId !== currentRunId.current) return;
          loopID.current = timer.subscribe(runEachFrame, latestProps.current.duration);
        }, activeDelay);
      } else {
        loopID.current = timer.subscribe(runEachFrame, latestProps.current.duration);
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, runId: number) => {
    if (runId !== currentRunId.current) return;
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const activeDuration = latestProps.current.duration;
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      currentData.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(runId);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(latestProps.current.easing)];
    const currentFrameData = interpolator.current(ease(step));
    currentData.current = currentFrameData;
    setState({
      data: currentFrameData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
