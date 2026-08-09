// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 3eb48e3ec9fc25df573c1bc624719a87102e555fdb3d165cdd3c4b70fc50ca58
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
  const visibleData = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const ease = d3Ease[formatAnimationName(easing)];
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const animationID = React.useRef(0);
  const hasStarted = React.useRef(false);
  const initialData = React.useRef(data);
  const previousData = React.useRef<AnimationData | undefined>(undefined);
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easingRef = React.useRef(ease);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  delayRef.current = delay;
  easingRef.current = ease;
  onEndRef.current = onEnd;

  const cancelAnimation = () => {
    animationID.current += 1;
    interpolator.current = null;

    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const runAnimationFrame = (elapsed: number, currentAnimationID: number) => {
    if (currentAnimationID !== animationID.current || !interpolator.current) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1. If this
    // happens set the state to 1 and return, cancelling the timer.
    const step = durationRef.current ? elapsed / durationRef.current : 1;
    const currentInterpolator = interpolator.current;

    if (step >= 1) {
      const endData = currentInterpolator(1);
      visibleData.current = endData;
      setState({
        data: endData,
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
      interpolator.current = null;
      queue.current.shift();
      startAnimation();
      return;
    }

    // Use the current easing function so changes to animation settings are
    // applied to an animation that is already in progress.
    const nextData = currentInterpolator(easingRef.current(step));
    visibleData.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const startAnimation = () => {
    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }

    const nextData = queue.current[0];
    const currentAnimationID = ++animationID.current;
    interpolator.current = victoryInterpolator(visibleData.current, nextData);

    const subscribe = () => {
      delayID.current = undefined;
      if (currentAnimationID !== animationID.current) {
        return;
      }
      loopID.current = timer.subscribe(
        (elapsed) => runAnimationFrame(elapsed, currentAnimationID),
        durationRef.current,
      );
    };

    if (delayRef.current) {
      delayID.current = setTimeout(subscribe, delayRef.current);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    // Start the initial queue, or replace the current queue when data changes.
    cancelAnimation();
    const isInitialEffectReplay =
      hasStarted.current &&
      previousData.current === data &&
      initialData.current === data;

    if (hasStarted.current && !isInitialEffectReplay) {
      queue.current = Array.isArray(data) ? data.slice() : [data];
      startAnimation();
    } else {
      hasStarted.current = true;
      queue.current = Array.isArray(data) ? data.slice(1) : [];
      if (queue.current.length) {
        startAnimation();
      }
    }
    previousData.current = data;

    return () => {
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
