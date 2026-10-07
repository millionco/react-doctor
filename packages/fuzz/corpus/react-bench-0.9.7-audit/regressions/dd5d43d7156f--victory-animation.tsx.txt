// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit dd5d43d7156f31fd2a444729f2843201a30359051efd8e53d8ac86771a8e0424
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

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const dataRef = React.useRef(data);
  const latestData = React.useRef(data);
  const activeData = React.useRef(data);
  const visibleData = React.useRef(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);

  visibleData.current = state.data;
  latestData.current = data;
  durationRef.current = duration;
  delayRef.current = delay;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  const setAnimationState = (nextState: VictoryAnimationState) => {
    visibleData.current = nextState.data;
    if (mounted.current) {
      setState(nextState);
    }
  };

  const cancelRun = () => {
    runID.current += 1;

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (currentRun: number) => {
    if (
      !mounted.current ||
      currentRun !== runID.current ||
      activeData.current !== latestData.current
    ) {
      return;
    }

    if (!queue.current.length) {
      interpolator.current = null;
      onEndRef.current?.();
      return;
    }

    interpolator.current = victoryInterpolator(
      visibleData.current,
      queue.current[0],
    );

    const start = () => {
      delayID.current = undefined;
      if (
        !mounted.current ||
        currentRun !== runID.current ||
        activeData.current !== latestData.current
      ) {
        return;
      }
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, currentRun),
        durationRef.current,
      );
    };

    if (delayRef.current) {
      delayID.current = setTimeout(start, delayRef.current);
    } else {
      start();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, currentRun: number) => {
    if (
      !mounted.current ||
      currentRun !== runID.current ||
      activeData.current !== latestData.current ||
      !interpolator.current
    ) {
      return;
    }

    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      setAnimationState({
        data: interpolator.current(1),
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
      traverseQueue(currentRun);
      return;
    }

    setAnimationState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  React.useEffect(() => {
    mounted.current = true;

    // Length check prevents `onEnd` for an initial, non-queued value.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    return () => {
      mounted.current = false;
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (dataRef.current === data) {
      return;
    }
    dataRef.current = data;
    cancelRun();
    activeData.current = data;
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue(runID.current);
    // Data alone replaces a run. Timing and callback props are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
