// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit cc926c9db3cd2e8f92ff4336b34419d70c4f29f75b19ff0f7b769e5fefac5d1c
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const currentStyle = React.useRef<AnimationStyle>(initialData);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const isActive = React.useRef(false);
  const initialized = React.useRef(false);
  const previousData = React.useRef<AnimationData>(data);
  const onEndRef = React.useRef(onEnd);
  const ease = d3Ease[formatAnimationName(easing)];

  // Completion must always use the most recently rendered callback, even when
  // the callback changes while a timer is already running.
  onEndRef.current = onEnd;

  const updateState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentStyle.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const cancelRun = () => {
    runID.current += 1;
    isActive.current = false;

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    const nextData = queue.current[0];
    if (!nextData) {
      isActive.current = false;
      onEndRef.current?.();
      return;
    }

    isActive.current = true;
    const interpolator = victoryInterpolator(currentStyle.current, nextData);
    const runFrame = (elapsed: number) => {
      if (id !== runID.current) return;

      // Step can generate imprecise values, sometimes greater than 1.
      const step = duration ? elapsed / duration : 1;

      if (step >= 1) {
        updateState(interpolator(1), {
          progress: 1,
          animating: false,
          terminating: true,
        });
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        queue.current.shift();
        isActive.current = false;
        traverseQueue(id);
        return;
      }

      updateState(interpolator(ease(step)), {
        progress: step,
        animating: true,
      });
    };

    const start = () => {
      if (id !== runID.current) return;
      delayID.current = undefined;
      loopID.current = timer.subscribe(runFrame, duration);
    };

    if (delay) {
      delayID.current = setTimeout(start, delay);
    } else {
      start();
    }
  };

  React.useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // Keep the initial queue semantics: an array is traversed in order and
      // an object has one (possibly identity) tween.
      queue.current = Array.isArray(data) ? data.slice() : [data];
      traverseQueue(runID.current);
    } else if (previousData.current !== data) {
      // Start replacements at the current frame, never at the old target.
      cancelRun();
      queue.current = Array.isArray(data) ? data.slice() : [data];
      previousData.current = data;
      traverseQueue(runID.current);
    } else if (isActive.current || queue.current.length) {
      // Rebuild the current tween with the latest duration and easing while
      // preserving its current destination and remaining ordered queue.
      cancelRun();
      traverseQueue(runID.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, delay, duration, easing, timer]);

  React.useEffect(() => {
    return () => {
      cancelRun();
    };
    // `timer` is intentionally included so a context-provided timer is also
    // cleaned up before it is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);

  return children(state.data, state.animationInfo);
};
