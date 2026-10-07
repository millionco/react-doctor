// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit decea037b49b9ab4a251ffaff59b08ce76ceeb19a65a85f2737c7fc0d3ecfe2c
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
  const timer = React.useContext(TimerContext).animationTimer;

  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  // Mirrors `state`, updated synchronously so a leg that completes and
  // immediately starts the next one always tweens from the true latest
  // value, without waiting for a render to commit first.
  const stateRef = React.useRef(state);

  // Always hold the latest settings, so an in-flight tween picks them up on
  // its next tick instead of the values captured when it was scheduled.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const easeFn = d3Ease[formatAnimationName(easing)];
  const easeRef = React.useRef(easeFn);
  easeRef.current = easeFn;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Identifies the current run of tweens. It's bumped whenever a run is
  // superseded, so any tick or delayed start it already scheduled can tell
  // it no longer speaks for the animation and should do nothing.
  const runID = React.useRef(0);
  const isInitialMount = React.useRef(true);

  const commitState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const advanceQueue = (myRunID: number) => {
    if (myRunID !== runID.current) return;

    if (!queue.current.length) {
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

    const beginTick = () => {
      if (myRunID !== runID.current) return;
      loopID.current = timer.subscribe(
        (elapsed) => tick(elapsed, myRunID),
        durationRef.current,
      );
    };

    if (delayRef.current) {
      delayID.current = setTimeout(() => {
        delayID.current = undefined;
        beginTick();
      }, delayRef.current);
    } else {
      beginTick();
    }
  };

  const tick = (elapsed: number, myRunID: number) => {
    if (myRunID !== runID.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1. If this
    // happens set the state to 1 and return, cancelling the timer.
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = queue.current[0];
      queue.current.shift();
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      commitState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      advanceQueue(myRunID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing the
    // current step value, transformed by the ease function, to the
    // interpolator, which is cached for performance whenever props are
    // received.
    commitState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    const myRunID = runID.current;

    if (isInitialMount.current) {
      // The first item in `data` is shown immediately (see initial state
      // above); `queue` already holds the rest, so there's nothing to redo.
      isInitialMount.current = false;
    } else {
      // Hand off from whatever is currently on screen toward the new data,
      // discarding any waypoints left over from the superseded run.
      queue.current = Array.isArray(data) ? data.slice() : [data];
    }

    // Skipping `advanceQueue` when the queue starts empty avoids firing
    // `onEnd` for a mount that never animated.
    if (queue.current.length) {
      advanceQueue(myRunID);
    }

    return () => {
      // Supersede this run. Anything it already scheduled will see a stale
      // runID and quietly stop instead of rendering or completing.
      runID.current += 1;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
