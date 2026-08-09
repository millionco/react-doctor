// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5afa5947cd53bd10eecf0ef039b1fca25b3de088226879eede2fcd0905e1ec4e
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

  // Latest props — active frames always read these so mid-run updates apply.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Mutable animation bookkeeping
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const animationData = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Bumped whenever a run is superseded or the component unmounts.
  const generationRef = React.useRef(0);
  const isFirstDataEffect = React.useRef(true);
  const traverseQueueRef = React.useRef<() => void>(() => {});

  const cancelActive = React.useCallback(() => {
    generationRef.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current !== null) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }
    interpolator.current = null;
  }, [timer]);

  const applyState = React.useCallback(
    (next: VictoryAnimationState, generation: number) => {
      setState((prev) =>
        generation !== generationRef.current ? prev : next,
      );
    },
    [],
  );

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, generation: number) => {
      if (generation !== generationRef.current || !interpolator.current) {
        return;
      }

      const currentDuration = durationRef.current;
      const ease = d3Ease[formatAnimationName(easingRef.current)];
      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        // Update the visible-style ref synchronously so the next queued step
        // (or a data-change handoff) continues from the true end value.
        const finalData = interpolator.current(1);
        if (generation !== generationRef.current) {
          return;
        }
        animationData.current = finalData;
        applyState(
          {
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          },
          generation,
        );
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        if (generation !== generationRef.current) {
          return;
        }
        queue.current.shift();
        traverseQueueRef.current();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const nextData = interpolator.current(ease(step));
      if (generation !== generationRef.current) {
        return;
      }
      animationData.current = nextData;
      applyState(
        {
          data: nextData,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        },
        generation,
      );
    },
    [applyState, timer],
  );

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      const generation = generationRef.current;

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        animationData.current,
        nextData,
      );

      const start = () => {
        if (generation !== generationRef.current) {
          return;
        }
        loopID.current = timer.subscribe((elapsed) => {
          functionToBeRunEachFrame(elapsed, generation);
        }, durationRef.current);
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
  };

  // Mount: start any queued array steps. Unmount: stop so completion cannot fire.
  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    return () => {
      cancelActive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data changes: hand off from the currently visible style to the new data.
  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }

    // Cancel the in-progress / delayed / queued run so it cannot render or complete.
    cancelActive();
    // Set the tween queue to the new data and continue from the visible style.
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
