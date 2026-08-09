// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d13ac0298040f3be8df7ddbb180dc8f9be03a7ddcf268508104b9b4dde317ee1
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
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const settings = React.useRef({ duration, easing, delay, onEnd });

  // Frame callbacks may outlive the render that created them. Keep all
  // settings they consume current without restarting the active tween.
  settings.current = { duration, easing, delay, onEnd };

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
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

  const traverseQueue = () => {
    if (!queue.current.length) {
      settings.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);
    const currentRunID = ++runID.current;

    const functionToBeRunEachFrame = (elapsed: number) => {
      if (currentRunID !== runID.current || !interpolator.current) {
        return;
      }

      const currentDuration = settings.current.duration;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        updateState({
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
        interpolator.current = null;
        runID.current += 1;
        traverseQueue();
        return;
      }

      const currentEase = d3Ease[formatAnimationName(settings.current.easing)];
      updateState({
        data: interpolator.current(currentEase(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    const start = () => {
      delayID.current = undefined;
      if (currentRunID !== runID.current || !mounted.current) {
        return;
      }
      loopID.current = timer.subscribe(
        functionToBeRunEachFrame,
        settings.current.duration,
      );
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(start, settings.current.delay);
    } else {
      start();
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    // Initial array data is an ordered list: render its first item and animate
    // through the remaining items. A single object is simply the initial style.
    if (queue.current.length) {
      traverseQueue();
    }

    return () => {
      mounted.current = false;
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // A replacement starts at the style currently on screen. Invalidating the
    // run also makes already-queued timer callbacks harmless.
    cancelRun();
    interpolator.current = null;
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
