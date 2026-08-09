// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 9e142bc01e351440ea4638eea15bf1be0f49bb030e69e6dba7a91e0d12d8fc89
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
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const animationGeneration = React.useRef(0);
  const prevDataRef = React.useRef(data);

  // Latest props so an in-progress run adopts updated duration/easing/onEnd/delay.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  // Currently visible style; used as the from-value when data is replaced mid-run.
  const visibleDataRef = React.useRef(state.data);

  durationRef.current = duration;
  easingRef.current = easing;
  onEndRef.current = onEnd;
  delayRef.current = delay;
  visibleDataRef.current = state.data;

  const clearTimer = React.useCallback(() => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueueRef = React.useRef<() => void>(() => {});

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, generation: number) => {
      if (generation !== animationGeneration.current || !interpolator.current) {
        return;
      }

      const currentDuration = durationRef.current;
      const ease = d3Ease[formatAnimationName(easingRef.current)];
      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        if (generation !== animationGeneration.current) {
          return;
        }

        const finalData = interpolator.current(1);
        visibleDataRef.current = finalData;
        setState({
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        clearTimer();
        queue.current.shift();

        if (generation !== animationGeneration.current) {
          return;
        }
        traverseQueueRef.current();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const nextData = interpolator.current(ease(step));
      visibleDataRef.current = nextData;
      setState({
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [clearTimer],
  );

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      const generation = animationGeneration.current;
      const start = () => {
        if (generation !== animationGeneration.current) {
          return;
        }
        // Reset step to zero
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, generation),
          durationRef.current,
        );
      };

      const currentDelay = delayRef.current;
      if (currentDelay) {
        delayTimeoutID.current = setTimeout(start, currentDelay);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  }, [timer, functionToBeRunEachFrame]);

  traverseQueueRef.current = traverseQueue;

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop so completion cannot fire after unmount
    return () => {
      animationGeneration.current += 1;
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (prevDataRef.current === data) {
      return;
    }
    prevDataRef.current = data;

    // Cancel the active run and continue from the currently visible style
    // toward the new data without flashing the superseded target.
    animationGeneration.current += 1;
    clearTimer();
    interpolator.current = null;
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
