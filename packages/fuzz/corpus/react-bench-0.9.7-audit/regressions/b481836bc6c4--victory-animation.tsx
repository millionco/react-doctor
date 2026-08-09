// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b481836bc6c44a929aeb2abc49f15e86ebeae571ee54376e7548e84b0cc4ca3b
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
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;

  // Refs to hold the latest prop values so our loop callback always uses up-to-date props
  const latestProps = React.useRef({ duration, easing, onEnd, delay });
  React.useEffect(() => {
    latestProps.current = { duration, easing, onEnd, delay };
  }, [duration, easing, onEnd, delay]);

  // Ref to hold the active run ID to handle cancellations and superseding of previous runs
  const activeRunId = React.useRef(0);

  // Ref to hold the previous data prop to check if it has deeply changed
  const prevDataRef = React.useRef<AnimationData | undefined>(undefined);

  // Ref to hold the currently visible style (last calculated/rendered style)
  const currentStyleRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  // Refs for tracking timer/timeout subscriptions
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<any>(undefined);

  const cleanupActiveRun = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
  };

  const processQueue = (runId: number, queue: AnimationStyle[]) => {
    if (runId !== activeRunId.current) return;

    if (queue.length === 0) {
      if (latestProps.current.onEnd) {
        latestProps.current.onEnd();
      }
      return;
    }

    const targetStyle = queue[0];
    const startStyle = currentStyleRef.current;
    const stepInterpolator = victoryInterpolator(startStyle, targetStyle);
    const currentDelay = latestProps.current.delay ?? 0;

    const startTimerSubscription = () => {
      if (runId !== activeRunId.current) return;

      const frameCallback = (elapsed: number) => {
        if (runId !== activeRunId.current) {
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          return;
        }

        const currentDuration =
          latestProps.current.duration ?? DEFAULT_DURATION;
        const currentEasing = latestProps.current.easing ?? "quadInOut";
        const easeFn =
          d3Ease[formatAnimationName(currentEasing)] || d3Ease.easeQuadInOut;

        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalStyle = stepInterpolator(1);
          setState({
            data: finalStyle,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });
          currentStyleRef.current = finalStyle;

          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }

          const remainingQueue = queue.slice(1);
          processQueue(runId, remainingQueue);
          return;
        }

        const interpolatedStyle = stepInterpolator(easeFn(step));
        setState({
          data: interpolatedStyle,
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
        currentStyleRef.current = interpolatedStyle;
      };

      const currentDuration = latestProps.current.duration ?? DEFAULT_DURATION;
      loopID.current = timer.subscribe(frameCallback, currentDuration);
    };

    if (currentDelay > 0) {
      delayTimeoutID.current = setTimeout(() => {
        delayTimeoutID.current = undefined;
        startTimerSubscription();
      }, currentDelay);
    } else {
      startTimerSubscription();
    }
  };

  React.useEffect(() => {
    if (prevDataRef.current !== undefined && isEqual(prevDataRef.current, data)) {
      return;
    }
    prevDataRef.current = data;

    const runId = ++activeRunId.current;
    cleanupActiveRun();

    const runQueue = Array.isArray(data) ? [...data] : [data];

    // On the initial run (runId === 1), if data is an array,
    // the first item is already set in the initial state, so we shift it to animate to the subsequent ones.
    const isFirstRun = runId === 1;
    if (isFirstRun && Array.isArray(data)) {
      runQueue.shift();
    }

    processQueue(runId, runQueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    return () => {
      cleanupActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
