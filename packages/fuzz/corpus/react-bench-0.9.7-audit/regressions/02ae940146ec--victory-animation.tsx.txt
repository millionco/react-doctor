// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 02ae940146ecdc92a6b3a54cfb73e51a04189e93d7c22ebc88a800b0d62f3933
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
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Latest visible style; used so replacements continue from the current frame
  // rather than a stale React state closure.
  const visibleDataRef = React.useRef<AnimationStyle>(initialData);
  // Bumped when a run is superseded or the component unmounts so late callbacks
  // cannot render or complete.
  const runIdRef = React.useRef(0);
  const isFirstDataEffect = React.useRef(true);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const clearDelayTimeout = React.useCallback(() => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
  }, []);

  const cancelActiveTimer = React.useCallback(() => {
    clearDelayTimeout();
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [clearDelayTimeout, timer]);

  const functionToBeRunEachFrameRef = React.useRef<
    (elapsed: number, animDuration: number) => void
  >(() => {});
  const traverseQueueRef = React.useRef<() => void>(() => {});

  functionToBeRunEachFrameRef.current = (
    elapsed: number,
    animDuration: number,
  ) => {
    if (!interpolator.current) return;

    const runId = runIdRef.current;
    // Prefer the live duration prop so mid-run updates take effect, but respect
    // Timer's 0 duration when animations are bypassed.
    const currentDuration = animDuration === 0 ? 0 : durationRef.current;
    const ease = d3Ease[formatAnimationName(easingRef.current)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      // Do not render or complete a superseded animation.
      if (runId !== runIdRef.current) return;

      const finalData = interpolator.current(1);
      visibleDataRef.current = finalData;
      setState((prev) => {
        if (runId !== runIdRef.current) return prev;
        return {
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        };
      });

      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }

      if (runId !== runIdRef.current) return;

      queue.current.shift();
      traverseQueueRef.current();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const nextData = interpolator.current(ease(step));
    setState((prev) => {
      if (runId !== runIdRef.current) return prev;
      visibleDataRef.current = nextData;
      return {
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      };
    });
  };

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      const fromData = visibleDataRef.current;

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(fromData, nextData);

      const runId = runIdRef.current;
      const startLoop = () => {
        if (runId !== runIdRef.current) return;
        loopID.current = timer.subscribe(
          (elapsed, animDuration) =>
            functionToBeRunEachFrameRef.current(elapsed, animDuration),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayTimeoutID.current = setTimeout(startLoop, delayRef.current);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  // Unmount: stop the active timer/timeout so completion cannot fire afterward
  React.useEffect(() => {
    return () => {
      runIdRef.current += 1;
      clearDelayTimeout();
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
  }, [clearDelayTimeout, timer]);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      if (queue.current.length) {
        traverseQueueRef.current();
      }
      return;
    }

    // Data changed: continue from the currently visible style toward the new
    // data without flashing the superseded target. Invalidate the prior run so
    // it cannot render or complete later.
    runIdRef.current += 1;
    cancelActiveTimer();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueueRef.current();
  }, [data, cancelActiveTimer]);

  return children(state.data, state.animationInfo);
};
