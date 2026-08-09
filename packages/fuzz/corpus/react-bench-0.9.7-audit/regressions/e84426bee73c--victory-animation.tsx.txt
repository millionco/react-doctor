// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit e84426bee73cc11cf7c09b52858517f0e63e4cc4269fd4332c84fd52a12a9379
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

  // Latest props — active frame callbacks always read from these refs
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);

  // Mutable animation bookkeeping
  const stateDataRef = React.useRef(state.data);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  // Bumped whenever a run is cancelled so superseded callbacks no-op
  const generationRef = React.useRef(0);
  const isFirstDataEffectRef = React.useRef(true);

  durationRef.current = duration;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  stateDataRef.current = state.data;

  const clearActiveTimer = () => {
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const cancelActive = () => {
    generationRef.current += 1;
    clearActiveTimer();
  };

  const traverseQueueRef = React.useRef<() => void>(() => {});
  const functionToBeRunEachFrameRef = React.useRef<(elapsed: number) => void>(
    () => {},
  );

  functionToBeRunEachFrameRef.current = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      stateDataRef.current = finalData;
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
    const nextData = interpolator.current(easeRef.current(step));
    stateDataRef.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      const generation = generationRef.current;

      // Compare cached version to next props — start from currently visible style
      interpolator.current = victoryInterpolator(
        stateDataRef.current,
        nextData,
      );

      const startLoop = () => {
        if (generation !== generationRef.current) return;
        loopID.current = timer.subscribe((elapsed) => {
          if (generation !== generationRef.current) return;
          functionToBeRunEachFrameRef.current(elapsed);
        }, durationRef.current);
      };

      if (delayRef.current) {
        delayTimeoutRef.current = setTimeout(startLoop, delayRef.current);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    // Clean up the animation loop — invalidate so delayed/queued completions
    // cannot fire after unmount
    return () => {
      cancelActive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Skip the initial mount; the mount effect owns the first queue traversal
    if (isFirstDataEffectRef.current) {
      isFirstDataEffectRef.current = false;
      return;
    }

    // Cancel any in-progress or delayed run so a superseded animation cannot
    // render or complete later. Continue from the currently visible style
    // toward the new data without flashing the old target.
    cancelActive();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
