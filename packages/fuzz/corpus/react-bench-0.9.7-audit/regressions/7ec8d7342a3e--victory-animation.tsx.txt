// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 7ec8d7342a3e8fc4dd349f2a4493d2bff7bc679deb73269b9b4e7b4a757b6cf4
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

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Latest visible style — used as the start point when data is replaced mid-run.
  const visibleData = React.useRef<AnimationStyle>(initialData);
  // Bumped whenever an in-flight run is superseded or the component unmounts.
  const generation = React.useRef(0);
  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };

  const traverseQueueRef = React.useRef<() => void>(() => {});

  const clearTimers = React.useCallback(() => {
    if (delayTimeoutID.current !== null) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, runGeneration: number) => {
      if (runGeneration !== generation.current || !interpolator.current) {
        return;
      }

      const { duration: currentDuration, easing: currentEasing } =
        propsRef.current;
      const ease = d3Ease[formatAnimationName(currentEasing)];

      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator.current(1);
        visibleData.current = finalData;
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
        traverseQueueRef.current();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const nextData = interpolator.current(ease(step));
      visibleData.current = nextData;
      setState({
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer],
  );

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        visibleData.current,
        nextData,
      );

      const runGeneration = generation.current;

      const startLoop = () => {
        if (runGeneration !== generation.current) {
          return;
        }
        loopID.current = timer.subscribe((elapsed) => {
          functionToBeRunEachFrame(elapsed, runGeneration);
        }, propsRef.current.duration);
      };

      // Reset step to zero
      if (propsRef.current.delay) {
        delayTimeoutID.current = setTimeout(startLoop, propsRef.current.delay);
      } else {
        startLoop();
      }
    } else if (propsRef.current.onEnd) {
      // Always invoke the latest onEnd when the queue completes.
      propsRef.current.onEnd();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    // Clean up the animation loop and any pending delayed start
    return () => {
      generation.current += 1;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstDataEffect = React.useRef(true);
  React.useEffect(() => {
    // Mount is handled by the effect above so array queues keep their
    // sliced-first-entry initial state without an extra self-tween.
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }

    // Supersede any in-progress or delayed run. Do not flash its target or
    // allow it to complete / invoke onEnd.
    generation.current += 1;
    clearTimers();

    // Continue from the currently visible style toward the new data.
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
