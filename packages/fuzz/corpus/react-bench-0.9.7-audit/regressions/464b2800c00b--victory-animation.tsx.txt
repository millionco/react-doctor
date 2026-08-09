// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 464b2800c00b0a3517d98adb2b11f693a11243cfabb50e8b815bbb86a177e520
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
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const currentData = React.useRef<AnimationStyle>(state.data);
  const activeTarget = React.useRef<AnimationStyle | null>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Each new request invalidates callbacks from the preceding timer (and from
  // a delayed start). This is important because a timer callback can otherwise
  // run after it has been unsubscribed.
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const completionPending = React.useRef(false);
  const onEndRef = React.useRef(onEnd);
  const previousProps = React.useRef({ data, duration, easing, delay });

  onEndRef.current = onEnd;

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
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
    activeTarget.current = null;
  };

  const traverseQueue = () => {
    const nextData = queue.current.shift();
    if (!nextData) {
      if (completionPending.current) {
        completionPending.current = false;
        onEndRef.current?.();
      }
      return;
    }

    const id = runID.current;
    const interpolator = victoryInterpolator(currentData.current, nextData);
    const ease = d3Ease[formatAnimationName(easing)];
    activeTarget.current = nextData;
    setAnimationState(currentData.current, { progress: 0, animating: true });

    const functionToBeRunEachFrame = (elapsed: number) => {
      if (id !== runID.current) return;

      const step = duration ? elapsed / duration : 1;
      if (step >= 1) {
        setAnimationState(interpolator(1), {
          progress: 1,
          animating: false,
          terminating: true,
        });
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        activeTarget.current = null;
        traverseQueue();
        return;
      }

      setAnimationState(interpolator(ease(step)), {
        progress: step,
        animating: true,
      });
    };

    const start = () => {
      if (id === runID.current) {
        delayID.current = undefined;
        loopID.current = timer.subscribe(functionToBeRunEachFrame, duration);
      }
    };

    if (delay) {
      delayID.current = setTimeout(start, delay);
    } else {
      start();
    }
  };

  React.useEffect(() => {
    return () => {
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (queue.current.length) {
        completionPending.current = true;
        traverseQueue();
      }
      return;
    }

    const previous = previousProps.current;
    const dataChanged = previous.data !== data;
    const settingsChanged =
      previous.duration !== duration ||
      previous.easing !== easing ||
      previous.delay !== delay;

    if (dataChanged || (settingsChanged && activeTarget.current)) {
      // A replacement starts at the frame currently on screen. Retaining the
      // remaining queue for a settings-only update preserves array ordering.
      const nextQueue = dataChanged
        ? Array.isArray(data)
          ? data.slice()
          : [data]
        : [activeTarget.current!, ...queue.current];
      cancelRun();
      queue.current = nextQueue;
      completionPending.current = true;
      traverseQueue();
    }
    previousProps.current = { data, duration, easing, delay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, duration, easing, delay]);

  return children(state.data, state.animationInfo);
};
