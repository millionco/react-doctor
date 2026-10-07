// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2eaa884472a05bd7d41d448292b1b80757767e3c2f9f901edb6e0b559c198c11
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
  const isInitialRender = React.useRef(true);
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: Array.isArray(data) ? data[0] : data,
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
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const updateState = React.useCallback((nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const cancelScheduledWork = React.useCallback(() => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const startQueue = React.useCallback(
    (id: number) => {
      if (!mounted.current || id !== runID.current) return;

      const nextData = queue.current[0];
      if (!nextData) {
        settings.current.onEnd?.();
        return;
      }

      const interpolator = victoryInterpolator(stateRef.current.data, nextData);
      const runFrame = (elapsed: number) => {
        if (!mounted.current || id !== runID.current) return;

        const latestDuration = settings.current.duration;
        const step = latestDuration ? elapsed / latestDuration : 1;

        if (step >= 1) {
          const nextState = {
            data: interpolator(1),
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
          startQueue(id);
          return;
        }

        const ease = d3Ease[formatAnimationName(settings.current.easing)];
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
        if (!mounted.current || id !== runID.current) return;
        loopID.current = timer.subscribe(runFrame, settings.current.duration);
      };

      if (settings.current.delay) {
        delayID.current = setTimeout(subscribe, settings.current.delay);
      } else {
        subscribe();
      }
    },
    [timer, updateState],
  );

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      startQueue(runID.current);
    }

    return () => {
      mounted.current = false;
      runID.current += 1;
      cancelScheduledWork();
    };
  }, [cancelScheduledWork, startQueue]);

  React.useLayoutEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }

    runID.current += 1;
    cancelScheduledWork();
    queue.current = Array.isArray(data) ? [...data] : [data];
    startQueue(runID.current);
  }, [cancelScheduledWork, data, startQueue]);

  return children(state.data, state.animationInfo);
};
