// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 41dd0323d301bd114bcee56779790f9a59efa340260c12696f68fb4a44856df9
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
  const stateRef = React.useRef(state);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const loopID = React.useRef<number | undefined>();
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>();
  const generation = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const previousSettings = React.useRef({ duration, easing });
  const onEndRef = React.useRef(onEnd);
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);

  onEndRef.current = onEnd;
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;

  const updateState = React.useCallback((nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const cancelRun = React.useCallback(() => {
    generation.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (!mounted.current) return;

    const nextData = queue.current[0];
    if (!nextData) {
      onEndRef.current?.();
      return;
    }

    const runGeneration = generation.current;
    const interpolator = victoryInterpolator(stateRef.current.data, nextData);
    const runDuration = durationRef.current;
    const ease = d3Ease[formatAnimationName(easingRef.current)];

    const frame = (elapsed: number) => {
      if (!mounted.current || runGeneration !== generation.current) return;

      const step = runDuration ? elapsed / runDuration : 1;
      if (step >= 1) {
        updateState({
          data: interpolator(1),
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
        traverseQueue();
        return;
      }

      updateState({
        data: interpolator(ease(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    const subscribe = () => {
      delayID.current = undefined;
      if (!mounted.current || runGeneration !== generation.current) return;
      loopID.current = timer.subscribe(frame, runDuration);
    };

    if (delayRef.current) {
      delayID.current = setTimeout(subscribe, delayRef.current);
    } else {
      subscribe();
    }
  }, [timer, updateState]);

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      traverseQueue();
    }

    return () => {
      mounted.current = false;
      cancelRun();
    };
  }, [cancelRun, traverseQueue]);

  React.useEffect(() => {
    if (Object.is(previousData.current, data)) {
      return;
    }
    previousData.current = data;

    cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
  }, [cancelRun, data, traverseQueue]);

  React.useEffect(() => {
    const previous = previousSettings.current;
    if (previous.duration === duration && previous.easing === easing) {
      return;
    }
    previousSettings.current = { duration, easing };

    if (queue.current.length) {
      cancelRun();
      traverseQueue();
    }
  }, [cancelRun, duration, easing, traverseQueue]);

  return children(state.data, state.animationInfo);
};
