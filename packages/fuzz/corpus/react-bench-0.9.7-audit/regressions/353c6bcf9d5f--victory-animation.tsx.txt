// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 353c6bcf9d5f90708788ee5ab90dec07277017ffc68f0b678345ba2930b1f820
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The style currently on screen, kept in a ref so a tween can always
  // resume from what's actually visible, even from a callback that was
  // scheduled by an earlier render.
  const visibleStyle = React.useRef(state.data);
  // Identifies the run allowed to render/complete. Bumped whenever `data`
  // changes so callbacks from a superseded run become no-ops.
  const runID = React.useRef(0);
  const hasMounted = React.useRef(false);

  // Latest settings, so a callback that was already scheduled adopts
  // changes instead of finishing with whatever was current when it started.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  easeRef.current = d3Ease[formatAnimationName(easing)];
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const updateVisibleStyle = (
    nextStyle: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleStyle.current = nextStyle;
    setState({ data: nextStyle, animationInfo });
  };

  const cancelScheduledWork = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop so completion cannot fire after unmount
    return () => {
      cancelScheduledWork();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    // Supersede whatever's currently running -- a fresh tween, a queued
    // step, or an earlier replacement -- and continue from the style
    // that's actually on screen instead of jumping to its old target.
    cancelScheduledWork();
    const thisRun = ++runID.current;
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(thisRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (thisRun: number) => {
    if (thisRun !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(visibleStyle.current, nextData);

      const start = () => {
        if (thisRun !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(thisRun, elapsed),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          start();
        }, delay);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (thisRun: number, elapsed: number) => {
    if (thisRun !== runID.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      cancelScheduledWork();
      updateVisibleStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      queue.current.shift();
      traverseQueue(thisRun);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    updateVisibleStyle(interpolator.current(easeRef.current(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  return children(state.data, state.animationInfo);
};
