// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0fa12138d5999076452ad73574ec19f322ae94f115047023fa70717df88b7853
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

/** Single animation object to interpolate. */
export type AnimationStyle = { [key: string]: string | number };
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
    animationInfo: { progress: 0, animating: false },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>([]);
  const visibleData = React.useRef(initialData);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(false);
  const firstData = React.useRef(true);

  // Timer callbacks intentionally read these refs so prop-only updates are
  // adopted by an animation that is already in progress.
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const cancelActive = () => {
    generation.current += 1;
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

    if (!queue.current.length) {
      settings.current.onEnd?.();
      return;
    }

    const interpolator = victoryInterpolator(
      visibleData.current,
      queue.current[0],
    );

    const frame = (elapsed: number) => {
      if (!mounted.current || run !== generation.current) return;

      const currentDuration = settings.current.duration;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator(1);
        visibleData.current = finalData;
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
        traverseQueue(run);
        return;
      }

      const ease = d3Ease[formatAnimationName(settings.current.easing)];
      const nextData = interpolator(ease(step));
      visibleData.current = nextData;
      setState({
        data: nextData,
        animationInfo: { progress: step, animating: true },
      });
    };

    const subscribe = () => {
      delayID.current = undefined;
      if (!mounted.current || run !== generation.current) return;
      loopID.current = timer.subscribe(frame, settings.current.duration);
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(subscribe, settings.current.delay);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      firstData.current = true;
      cancelActive();
    };
    // The timer is supplied by context and is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    cancelActive();
    const run = generation.current;

    if (firstData.current) {
      firstData.current = false;
      queue.current = Array.isArray(data) ? data.slice(1) : [data];
    } else {
      // A replacement always begins at the last frame actually rendered,
      // never at the superseded run's destination.
      queue.current = Array.isArray(data) ? data.slice() : [data];
    }
    traverseQueue(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
