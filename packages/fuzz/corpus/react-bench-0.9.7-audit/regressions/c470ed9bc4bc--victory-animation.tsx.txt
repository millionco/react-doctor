// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c470ed9bc4bc390dad38f1e4c9740a90a5724a54638d243f2bef98a06faf9675
import React from "react";
import isEqual from "react-fast-compare";
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

  // The style currently shown to the user. Every tween starts here so that a
  // `data` change mid-flight continues from the visible value instead of
  // flashing the superseded target.
  const currentData = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  // Remaining tween targets, animated through in order.
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Bumped whenever a run is superseded so a pending delayed start belonging to
  // the old run becomes inert and cannot render or complete later.
  const runID = React.useRef(0);
  // The `data` we last started a run for, compared deeply so that a new-but-
  // equal `data` reference (a fresh object every render) doesn't restart the run.
  const previousData = React.useRef<AnimationData>(data);

  // Mutable settings the running animation reads every frame. Refreshing them on
  // each render lets an in-progress animation adopt the latest `duration`,
  // `easing`, and `onEnd` without restarting.
  const ease = d3Ease[formatAnimationName(easing)];
  const settings = React.useRef({ duration, ease, delay, onEnd });
  settings.current = { duration, ease, delay, onEnd };

  const commit = (nextState: VictoryAnimationState) => {
    // Track the visible style synchronously so the next tween (a queued step or
    // a handoff) can start from it before React has re-rendered.
    currentData.current = nextState.data;
    setState(nextState);
  };

  // Tear down the in-flight run — an active loop and/or a pending delayed start —
  // and mark it superseded so nothing from it can render or complete afterward.
  const cancelActiveRun = () => {
    runID.current += 1;
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Read the latest settings so an in-progress animation honors prop changes.
    const { duration: currentDuration, ease } = settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      commit({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    commit({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Always interpolate from the currently visible style toward the target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const { delay: currentDelay, duration: currentDuration } =
        settings.current;
      const run = runID.current;
      const subscribe = () => {
        // A newer run may have superseded this one during the delay.
        if (run !== runID.current) return;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      };

      // Reset step to zero
      if (currentDelay) {
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = undefined;
          subscribe();
        }, currentDelay);
      } else {
        subscribe();
      }
    } else if (settings.current.onEnd) {
      // Only the latest run reaches this point, and it invokes the latest onEnd.
      settings.current.onEnd();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop and any pending delayed start so completion
    // cannot fire after unmount.
    return () => {
      const hadActiveLoop = Boolean(loopID.current);
      cancelActiveRun();
      if (!hadActiveLoop) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // `data` is frequently a new reference with equal contents (e.g. a fresh
    // object built every render), so only react to genuine changes.
    if (isEqual(previousData.current, data)) {
      return;
    }
    previousData.current = data;

    // Supersede the in-flight run, then continue from the currently visible
    // style toward the new data. The old run is torn down first so it can
    // neither render nor complete, and its target is never flashed.
    cancelActiveRun();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
