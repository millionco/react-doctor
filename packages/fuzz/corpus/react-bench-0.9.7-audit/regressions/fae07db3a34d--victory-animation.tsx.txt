// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit fae07db3a34db49f0dd44ca3b8c89ca2a61ab43ffe1fe334c05b9489c3beaeb0
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
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

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
  const currentState = React.useRef(state);
  const animationProps = React.useRef({ duration, easing, delay, onEnd });
  const timerRef = React.useRef(timer);
  const queue = React.useRef<AnimationStyle[]>([]);
  const loopID = React.useRef<number | undefined>(undefined);
  const loopTimer = React.useRef(timer);
  const delayTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const animationID = React.useRef(0);
  const activeAnimationID = React.useRef<number | undefined>(undefined);
  const queueWillComplete = React.useRef(false);
  const mounted = React.useRef(false);
  const hasHandledInitialData = React.useRef(false);

  // Timer callbacks can outlive the render that started them. Keep the values
  // they need to read current instead of closing over one render's props.
  animationProps.current = { duration, easing, delay, onEnd };
  timerRef.current = timer;

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    const nextState = { data: nextData, animationInfo };
    currentState.current = nextState;
    setState(nextState);
  };

  const unsubscribeLoop = () => {
    const id = loopID.current;
    loopID.current = undefined;

    if (id !== undefined) {
      loopTimer.current.unsubscribe(id);
    }
  };

  const cancelAnimation = () => {
    // Invalidate callbacks before clearing their timers. A callback that has
    // already been queued by the timer then becomes a no-op.
    animationID.current += 1;
    activeAnimationID.current = undefined;

    if (delayTimer.current !== undefined) {
      clearTimeout(delayTimer.current);
      delayTimer.current = undefined;
    }

    unsubscribeLoop();
  };

  const completeQueue = () => {
    if (!mounted.current || !queueWillComplete.current) {
      return;
    }

    queueWillComplete.current = false;
    animationProps.current.onEnd?.();
  };

  const traverseQueue = () => {
    if (!mounted.current) {
      return;
    }

    if (!queue.current.length) {
      completeQueue();
      return;
    }

    const nextData = queue.current[0];
    const nextInterpolator = victoryInterpolator(
      currentState.current.data,
      nextData,
    );
    const id = ++animationID.current;
    activeAnimationID.current = id;

    const functionToBeRunEachFrame = (elapsed: number) => {
      if (!mounted.current || activeAnimationID.current !== id) {
        return;
      }

      const { duration: currentDuration, easing: currentEasing } =
        animationProps.current;
      // Step can generate imprecise values, sometimes greater than 1.
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        setAnimationState(nextInterpolator(1), {
          progress: 1,
          animating: false,
          terminating: true,
        });
        activeAnimationID.current = undefined;
        unsubscribeLoop();
        queue.current.shift();
        traverseQueue();
        return;
      }

      const ease = d3Ease[formatAnimationName(currentEasing)];
      setAnimationState(nextInterpolator(ease(step)), {
        progress: step,
        animating: step < 1,
      });
    };

    const startLoop = () => {
      if (!mounted.current || activeAnimationID.current !== id) {
        return;
      }

      const currentTimer = timerRef.current;
      loopTimer.current = currentTimer;
      const nextLoopID = currentTimer.subscribe(
        functionToBeRunEachFrame,
        animationProps.current.duration,
      );

      // A custom timer may invoke its callback synchronously while subscribing.
      // Do not retain a subscription that completed or was replaced in that
      // callback.
      if (mounted.current && activeAnimationID.current === id) {
        loopID.current = nextLoopID;
      } else {
        currentTimer.unsubscribe(nextLoopID);
      }
    };

    if (animationProps.current.delay) {
      setAnimationState(currentState.current.data, {
        progress: 0,
        animating: false,
      });
      delayTimer.current = setTimeout(() => {
        delayTimer.current = undefined;
        startLoop();
      }, animationProps.current.delay);
    } else {
      startLoop();
    }
  };

  const replaceQueue = (nextQueue: AnimationStyle[]) => {
    cancelAnimation();
    queue.current = nextQueue;
    queueWillComplete.current = true;
    traverseQueue();
  };

  useIsomorphicLayoutEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      cancelAnimation();
      // React Strict Mode re-runs layout effects after their cleanup in
      // development. Treat that setup as a fresh mount as well.
      hasHandledInitialData.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!hasHandledInitialData.current) {
      hasHandledInitialData.current = true;

      // The first item is already rendered as the initial state. Subsequent
      // items retain VictoryAnimation's ordered queue behavior.
      const initialQueue = Array.isArray(data) ? data.slice(1) : [];
      if (initialQueue.length) {
        queue.current = initialQueue;
        queueWillComplete.current = true;
        traverseQueue();
      }
    } else {
      // Start at the exact style currently shown, not the old target. Copy the
      // incoming array because queue traversal removes completed entries.
      replaceQueue(Array.isArray(data) ? data.slice() : [data]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
