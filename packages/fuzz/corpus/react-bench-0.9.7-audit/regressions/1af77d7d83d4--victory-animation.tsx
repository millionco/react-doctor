// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1af77d7d83d4ce264ddc191bca73c052958816519e2606bd374192c27e0b00b7
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

type EaseFn = (t: number) => number;

const getEaseFunction = (easing: AnimationEasing): EaseFn => {
  const ease = d3Ease[formatAnimationName(easing)] as EaseFn | undefined;
  return ease || (d3Ease.easeQuadInOut as EaseFn);
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
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Bumped to invalidate in-flight timer callbacks and delayed starts.
  const generationRef = React.useRef(0);
  const currentDataRef = React.useRef<AnimationStyle>(initialData);
  const prevDataRef = React.useRef<AnimationData | null>(null);

  // Latest props — read by the active frame callback so mid-run updates apply.
  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };

  const clearTimers = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current !== null) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }
  }, [timer]);

  const traverseQueueRef = React.useRef<() => void>(() => {});

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(
        currentDataRef.current,
        nextData,
      );

      const generation = generationRef.current;

      const functionToBeRunEachFrame = (elapsed: number) => {
        if (generation !== generationRef.current || !interpolator.current) {
          return;
        }

        const {
          duration: currentDuration,
          easing: currentEasing,
        } = propsRef.current;
        const ease = getEaseFunction(currentEasing);

        // Step can generate imprecise values, sometimes greater than 1
        // if this happens set the state to 1 and return, cancelling the timer
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalData = interpolator.current(1);
          currentDataRef.current = finalData;
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
        // interpolator
        const nextStyle = interpolator.current(ease(step));
        currentDataRef.current = nextStyle;
        setState({
          data: nextStyle,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      };

      const startLoop = () => {
        if (generation !== generationRef.current) {
          return;
        }
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          propsRef.current.duration,
        );
      };

      if (propsRef.current.delay) {
        delayTimeoutID.current = setTimeout(startLoop, propsRef.current.delay);
      } else {
        startLoop();
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
  };

  React.useEffect(() => {
    const previousData = prevDataRef.current;
    const dataChanged = previousData !== null && previousData !== data;
    prevDataRef.current = data;

    if (dataChanged) {
      // Retarget from the currently visible style; do not flash the old end.
      generationRef.current += 1;
      clearTimers();
      queue.current = Array.isArray(data) ? data.slice() : [data];
      traverseQueueRef.current();
    } else if (queue.current.length) {
      // Mount (or Strict Mode remount): drain the queued steps without onEnd.
      traverseQueueRef.current();
    }

    return () => {
      // Stop the active timer / delayed start so completion cannot fire later.
      generationRef.current += 1;
      clearTimers();
    };
  }, [data, clearTimers]);

  return children(state.data, state.animationInfo);
};
