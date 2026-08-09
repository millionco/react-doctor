// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 76c565d85e4e6bdb1c8f65e29dd13c1d546bdf7ce069c34d9a76a2cc0eafcc0a
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

const getQueueFromData = (animationData: AnimationData): AnimationStyle[] => {
  return Array.isArray(animationData) ? animationData : [animationData];
};

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

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout>>();
  const runID = React.useRef(0);
  const currentData = React.useRef<AnimationStyle>(initialData);

  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);

  durationRef.current = duration;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  easeRef.current = d3Ease[formatAnimationName(easing)];

  const cancelTimer = React.useCallback(() => {
    if (delayTimeoutID.current) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const invalidateRun = React.useCallback(() => {
    runID.current += 1;
    cancelTimer();
  }, [cancelTimer]);

  const startSegment = React.useCallback(() => {
    const runId = runID.current;

    if (!queue.current.length) {
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(currentData.current, nextData);

    const begin = () => {
      if (runId !== runID.current) {
        return;
      }

      loopID.current = timer.subscribe((elapsed) => {
        if (runId !== runID.current || !interpolator.current) {
          return;
        }

        const currentDuration = durationRef.current;
        const step = currentDuration ? elapsed / currentDuration : 1;

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
          if (loopID.current) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          queue.current.shift();
          startSegment();
          return;
        }

        const interpolated = interpolator.current(easeRef.current(step));
        currentData.current = interpolated;
        setState({
          data: interpolated,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      }, durationRef.current);
    };

    if (delayRef.current) {
      delayTimeoutID.current = setTimeout(() => {
        delayTimeoutID.current = undefined;
        begin();
      }, delayRef.current);
    } else {
      begin();
    }
  }, [timer]);

  const handoffQueue = React.useCallback(
    (nextQueue: AnimationStyle[]) => {
      invalidateRun();
      queue.current = nextQueue;
      startSegment();
    },
    [invalidateRun, startSegment],
  );

  const restartCurrentSegment = React.useCallback(() => {
    const isActive =
      queue.current.length > 0 ||
      loopID.current !== undefined ||
      delayTimeoutID.current !== undefined;

    if (!isActive) {
      return;
    }

    invalidateRun();
    startSegment();
  }, [invalidateRun, startSegment]);

  React.useEffect(() => {
    if (queue.current.length) {
      startSegment();
    }

    return () => {
      invalidateRun();
      if (!loopID.current) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousData = React.useRef<AnimationData | null>(null);
  React.useEffect(() => {
    if (previousData.current === null) {
      previousData.current = data;
      return;
    }
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;
    handoffQueue(getQueueFromData(data));
  }, [data, handoffQueue]);

  const previousDuration = React.useRef(duration);
  const previousEasing = React.useRef(easing);
  const previousDelay = React.useRef(delay);
  React.useEffect(() => {
    if (
      previousDuration.current === duration &&
      previousEasing.current === easing &&
      previousDelay.current === delay
    ) {
      return;
    }
    previousDuration.current = duration;
    previousEasing.current = easing;
    previousDelay.current = delay;
    restartCurrentSegment();
  }, [duration, easing, delay, restartCurrentSegment]);

  return children(state.data, state.animationInfo);
};
