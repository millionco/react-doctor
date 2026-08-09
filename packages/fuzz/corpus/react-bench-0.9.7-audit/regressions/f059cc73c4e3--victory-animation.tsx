// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit f059cc73c4e3e2bb9f794576b4c3313c30d8226010a1e4ccb4e56e6b83d271f4
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
  const initialStyle = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialStyle,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;

  // Mirrors the currently visible/rendered style. Frame callbacks are
  // subscribed once per tween and can be invoked well after later renders
  // have occurred, so they read this ref (always current) instead of
  // closing over `state`, which would otherwise be stale.
  const visibleStyle = React.useRef<AnimationStyle>(initialStyle);

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
  const isInitialMount = React.useRef(true);

  // Latest settings, refreshed every render, so an animation already in
  // progress adopts changes to these props without being restarted.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  easeRef.current = d3Ease[formatAnimationName(easing)];
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const setVisibleStyle = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleStyle.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  // Stops whatever this instance currently has pending: a delayed start
  // that hasn't subscribed yet, and/or an active per-frame subscription.
  const cancelActiveRun = () => {
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
    // Clean up the animation loop
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    cancelActiveRun();

    if (isInitialMount.current) {
      isInitialMount.current = false;
      // The first data value is used as the starting style with no
      // animation; only the rest of an array queue needs to be traversed.
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      // Length check prevents us from triggering `onEnd` when there's
      // nothing to animate toward on mount.
      if (queue.current.length) {
        traverseQueue();
      }
    } else {
      // Continue from whatever style is currently visible toward the new
      // data, rather than snapping to the superseded target first.
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare currently visible style to next props
      interpolator.current = victoryInterpolator(
        visibleStyle.current,
        nextData,
      );

      const subscribe = () => {
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayID.current = setTimeout(subscribe, delayRef.current);
      } else {
        subscribe();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setVisibleStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
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
    setVisibleStyle(interpolator.current(easeRef.current(step)), {
      progress: step,
      animating: true,
    });
  };

  return children(state.data, state.animationInfo);
};
