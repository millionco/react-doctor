// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b9cfb6d44d50c35026375667638813d1f5ef2e32de2c9298f13ec04ba07161f9
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

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
  const delayTimeout = React.useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const runId = React.useRef(0);
  const mounted = React.useRef(true);
  const stateDataRef = React.useRef<AnimationStyle>(state.data);

  // latest props refs – active animation adopts these
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  React.useEffect(() => {
    stateDataRef.current = state.data;
  }, [state.data]);

  const getEase = React.useCallback(() => {
    const fn = (d3Ease as any)[formatAnimationName(easingRef.current)];
    return fn || ((t: number) => t);
  }, []);

  const clearCurrent = React.useCallback(() => {
    if (delayTimeout.current !== null) {
      clearTimeout(delayTimeout.current as any);
      delayTimeout.current = null;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  // Process queue for a specific run id, invalidating superseded runs
  const processQueue = React.useCallback(
    (currentRunId: number) => {
      if (runId.current !== currentRunId || !mounted.current) {
        return;
      }
      if (!queue.current.length) {
        const cb = onEndRef.current;
        if (cb) {
          cb();
        }
        return;
      }
      const nextData = queue.current[0];
      // Interpolate from currently visible style
      interpolator.current = victoryInterpolator(
        stateDataRef.current,
        nextData,
      );

      const startLoop = () => {
        if (runId.current !== currentRunId || !mounted.current) {
          return;
        }
        delayTimeout.current = null;

        const frame = (elapsed: number) => {
          if (runId.current !== currentRunId || !mounted.current) {
            return;
          }
          if (!interpolator.current) return;

          const dur = durationRef.current;
          const easeFn = getEase();
          const step = dur ? elapsed / dur : 1;

          if (step >= 1) {
            const finalData = interpolator.current(1);
            stateDataRef.current = finalData;
            if (runId.current === currentRunId && mounted.current) {
              setState({
                data: finalData,
                animationInfo: {
                  progress: 1,
                  animating: false,
                  terminating: true,
                },
              });
            }
            if (loopID.current !== undefined) {
              timer.unsubscribe(loopID.current);
              loopID.current = undefined;
            }
            queue.current.shift();
            processQueue(currentRunId);
            return;
          }

          const eased = easeFn(step);
          const cur = interpolator.current(eased);
          stateDataRef.current = cur;
          if (runId.current === currentRunId && mounted.current) {
            setState({
              data: cur,
              animationInfo: {
                progress: step,
                animating: step < 1,
              },
            });
          }
        };

        loopID.current = timer.subscribe(frame as any, durationRef.current);
      };

      const d = delayRef.current;
      if (d) {
        delayTimeout.current = setTimeout(startLoop, d) as any;
      } else {
        startLoop();
      }
    },
    [getEase, timer],
  );

  // initial mount – start any queued animation from initial array data
  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      processQueue(runId.current);
    }
    return () => {
      mounted.current = false;
      if (delayTimeout.current !== null) {
        clearTimeout(delayTimeout.current as any);
        delayTimeout.current = null;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // handle data prop changes – continue from currently visible style toward new data
  const isFirstDataEffect = React.useRef(true);
  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }
    // New data – supersede any in-progress run
    clearCurrent();
    runId.current += 1;
    const currentRunId = runId.current;
    const nextQueue = Array.isArray(data) ? [...data] : [data];
    queue.current = nextQueue;
    processQueue(currentRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
