// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 98e2a0be27153ef1bcfd1c78eac52d52ae924dad5927861cd866425386fe9e25
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
  const stateRef = React.useRef(state);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const latest = React.useRef({ duration, easing, delay, onEnd });

  // Animation settings are intentionally read from a ref by active frame
  // callbacks. Updating them must not restart the current interpolation.
  latest.current = { duration, easing, delay, onEnd };

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const cancelStep = () => {
    generation.current += 1;

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
    if (!mounted.current || !queue.current.length) {
      return;
    }

    const nextData = queue.current[0];
    const interpolator = victoryInterpolator(stateRef.current.data, nextData);
    const stepGeneration = ++generation.current;

    const functionToBeRunEachFrame = (
      elapsed: number,
      subscribedDuration?: number,
    ) => {
      if (!mounted.current || generation.current !== stepGeneration) {
        return;
      }

      const currentDuration = latest.current.duration;
      // Timer uses a zero subscription duration when animations are bypassed.
      const step =
        subscribedDuration === 0 || !currentDuration
          ? 1
          : elapsed / currentDuration;

      if (step >= 1) {
        updateState({
          data: interpolator(1),
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });

        // Invalidate this callback before advancing the queue. A timer that
        // has already taken a snapshot of its subscribers may call it again.
        generation.current += 1;
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }

        queue.current.shift();
        if (queue.current.length) {
          traverseQueue();
        } else {
          latest.current.onEnd?.();
        }
        return;
      }

      const ease = d3Ease[formatAnimationName(latest.current.easing)];
      updateState({
        data: interpolator(ease(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    const subscribe = () => {
      delayID.current = undefined;
      if (!mounted.current || generation.current !== stepGeneration) {
        return;
      }

      updateState({
        data: stateRef.current.data,
        animationInfo: {
          progress: 0,
          animating: true,
        },
      });
      loopID.current = timer.subscribe(
        functionToBeRunEachFrame,
        latest.current.duration,
      );
    };

    if (latest.current.delay) {
      delayID.current = setTimeout(subscribe, latest.current.delay);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    mounted.current = true;

    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      mounted.current = false;
      cancelStep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The mount effect owns the initial array queue. Subsequent data changes
    // replace every outstanding step and begin at the currently visible data.
    if (previousData.current === data) {
      return;
    }

    previousData.current = data;
    cancelStep();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
