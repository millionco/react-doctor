// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 003adcf3eb35217d89a7b51f6fc48b35e09c168c4d48204732225703e2817ff5
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
    animationInfo: { progress: 0, animating: false },
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
  const previousProps = React.useRef({ data, duration, easing, delay });
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const updateState = React.useCallback((nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const cancel = React.useCallback(() => {
    generation.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  }, [timer]);

  const startQueue = React.useCallback(() => {
    const run = generation.current;
    const nextData = queue.current[0];
    if (!nextData) {
      settings.current.onEnd?.();
      return;
    }

    const interpolator = victoryInterpolator(stateRef.current.data, nextData);
    const start = () => {
      if (generation.current !== run) return;
      delayID.current = undefined;
      const runDuration = settings.current.duration;
      loopID.current = timer.subscribe((elapsed) => {
        if (generation.current !== run) return;
        const step = runDuration ? elapsed / runDuration : 1;

        if (step >= 1) {
          updateState({
            data: interpolator(1),
            animationInfo: { progress: 1, animating: false, terminating: true },
          });
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          queue.current.shift();
          startQueue();
          return;
        }

        updateState({
          data: interpolator(
            d3Ease[formatAnimationName(settings.current.easing)](step),
          ),
          animationInfo: { progress: step, animating: true },
        });
      }, runDuration);
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(start, settings.current.delay);
    } else {
      start();
    }
  }, [timer, updateState]);

  React.useEffect(() => {
    const previous = previousProps.current;
    const dataChanged = previous.data !== data;
    const settingsChanged =
      previous.duration !== duration ||
      previous.easing !== easing ||
      previous.delay !== delay;

    if (!mounted.current) {
      mounted.current = true;
      if (queue.current.length) startQueue();
    } else if (dataChanged || (settingsChanged && queue.current.length)) {
      // The visible frame, rather than the old target, is the start of every handoff.
      cancel();
      if (dataChanged) {
        queue.current = Array.isArray(data) ? data.slice() : [data];
      }
      startQueue();
    }

    previousProps.current = { data, duration, easing, delay };
  }, [cancel, data, delay, duration, easing, startQueue]);

  React.useEffect(() => () => cancel(), [cancel]);

  return children(state.data, state.animationInfo);
};
