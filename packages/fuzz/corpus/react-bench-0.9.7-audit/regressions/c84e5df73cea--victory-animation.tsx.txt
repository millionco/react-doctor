// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c84e5df73ceadfaaca01ae9fd5e280174d0a798f60dea42202c3907b33bb3e8b
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

/** d3-ease changed the naming scheme from "linear" to "easeLinear", etc. */
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
  const initialData = React.useRef(
    Array.isArray(data) ? data[0] : data,
  ).current;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: { progress: 0, animating: false },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const stateRef = React.useRef(state);
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
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const renderState = (nextState: VictoryAnimationState) => {
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

  const traverseQueue = (id: number) => {
    if (!mounted.current || id !== runID.current) return;

    const nextData = queue.current[0];
    if (!nextData) {
      interpolator.current = null;
      settings.current.onEnd?.();
      return;
    }

    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);
    const start = () => {
      delayID.current = undefined;
      if (!mounted.current || id !== runID.current) return;
      loopID.current = timer.subscribe(
        (elapsed) => runFrame(elapsed, id),
        settings.current.duration,
      );
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(start, settings.current.delay);
    } else {
      start();
    }
  };

  const runFrame = (elapsed: number, id: number) => {
    if (!mounted.current || id !== runID.current || !interpolator.current) {
      return;
    }

    const currentDuration = settings.current.duration;
    const step = currentDuration ? elapsed / currentDuration : 1;
    if (step >= 1) {
      const finishedInterpolator = interpolator.current;
      renderState({
        data: finishedInterpolator(1),
        animationInfo: { progress: 1, animating: false, terminating: true },
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    const ease = d3Ease[formatAnimationName(settings.current.easing)];
    renderState({
      data: interpolator.current(ease(step)),
      animationInfo: { progress: step, animating: true },
    });
  };

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) traverseQueue(runID.current);

    return () => {
      mounted.current = false;
      runID.current += 1;
      cancelScheduledWork();
    };
    // The timer belongs to the context for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current === data) return;
    previousData.current = data;

    // A replacement starts at the last frame React was asked to render. The
    // generation check also makes already-dispatched callbacks harmless.
    cancelScheduledWork();
    runID.current += 1;
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
