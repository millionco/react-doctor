// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit ba7f2c41098093636e59e01e06769795f583d2a18511a2ed179115ad63a5188d
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
  const initialData = React.useRef(data);
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const stateRef = React.useRef(state);
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(false);
  const firstDataEffect = React.useRef(true);
  const hasReceivedNewData = React.useRef(false);
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
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

  const traverseQueue = (run: number) => {
    if (!mounted.current || run !== generation.current) return;

    const nextData = queue.current[0];
    if (!nextData) {
      interpolator.current = null;
      settings.current.onEnd?.();
      return;
    }

    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

    const frame = (elapsed: number) => {
      if (
        !mounted.current ||
        run !== generation.current ||
        !interpolator.current
      ) {
        return;
      }

      const currentDuration = settings.current.duration;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const nextState = {
          data: interpolator.current(1),
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        };
        updateState(nextState);
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        queue.current.shift();
        traverseQueue(run);
        return;
      }

      const ease = d3Ease[formatAnimationName(settings.current.easing)];
      updateState({
        data: interpolator.current(ease(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    const subscribe = () => {
      delayID.current = undefined;
      if (mounted.current && run === generation.current) {
        loopID.current = timer.subscribe(frame, settings.current.duration);
      }
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(subscribe, settings.current.delay);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    queue.current = Array.isArray(initialData.current)
      ? initialData.current.slice(1)
      : [];
    if (queue.current.length) {
      traverseQueue(generation.current);
    }

    return () => {
      mounted.current = false;
      generation.current += 1;
      cancelScheduledWork();
    };
    // This effect owns the lifetime of the timer subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // React Strict Mode replays effects on mount. Treat that replay as the
    // initial data too, rather than manufacturing a replacement animation.
    if (
      firstDataEffect.current ||
      (!hasReceivedNewData.current && data === initialData.current)
    ) {
      firstDataEffect.current = false;
      return;
    }

    hasReceivedNewData.current = true;
    generation.current += 1;
    const run = generation.current;
    cancelScheduledWork();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // stateRef is updated with every rendered frame, so replacement runs begin
    // at the currently visible value rather than the superseded destination.
    traverseQueue(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
