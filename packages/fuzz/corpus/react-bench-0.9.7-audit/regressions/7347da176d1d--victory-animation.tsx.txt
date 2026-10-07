// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 7347da176d1d33d937dba843d740e635c5614dbf6574d1976dc819b844c0c798
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

  const stateRef = React.useRef<VictoryAnimationState>(state);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimerId = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const durationRef = React.useRef<number>(duration);
  const easingRef = React.useRef<AnimationEasing>(easing);
  const delayRef = React.useRef<number>(delay);
  const onEndRef = React.useRef<(() => void) | undefined>(onEnd);
  const runIdRef = React.useRef<number>(0);
  const mountedRef = React.useRef<boolean>(true);
  const isInitialDataEffect = React.useRef<boolean>(true);

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  React.useEffect(() => {
    durationRef.current = duration ?? DEFAULT_DURATION;
  }, [duration]);
  React.useEffect(() => {
    easingRef.current = easing;
  }, [easing]);
  React.useEffect(() => {
    delayRef.current = delay ?? 0;
  }, [delay]);
  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const getEase = React.useCallback(() => {
    const fn = d3Ease[formatAnimationName(easingRef.current)] as
      | ((t: number) => number)
      | undefined;
    return fn || ((t: number) => t);
  }, []);

  const cancelCurrent = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimerId.current !== undefined) {
      clearTimeout(delayTimerId.current);
      delayTimerId.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    const currentRunId = runIdRef.current;
    if (!mountedRef.current) return;
    if (runIdRef.current !== currentRunId) return;

    if (!queue.current.length) {
      const cb = onEndRef.current;
      if (cb) {
        cb();
      }
      return;
    }

    const nextData = queue.current[0];
    const startStyle = stateRef.current.data;
    interpolator.current = victoryInterpolator(startStyle, nextData);

    const startLoop = () => {
      delayTimerId.current = undefined;
      if (!mountedRef.current) return;
      if (runIdRef.current !== currentRunId) return;

      loopID.current = timer.subscribe((elapsed: number) => {
        if (!mountedRef.current) return;
        if (runIdRef.current !== currentRunId) return;
        if (!interpolator.current) return;

        const currentDuration = durationRef.current ?? DEFAULT_DURATION;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          if (runIdRef.current !== currentRunId) return;
          if (!interpolator.current) return;
          const finalData = interpolator.current(1);
          const newState: VictoryAnimationState = {
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          };
          stateRef.current = newState;
          if (mountedRef.current) {
            setState(newState);
          }
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          if (runIdRef.current === currentRunId) {
            queue.current.shift();
            traverseQueue();
          }
          return;
        }

        const easeFn = getEase();
        const eased = easeFn(step);
        if (runIdRef.current !== currentRunId) return;
        if (!mountedRef.current) return;
        if (!interpolator.current) return;

        const newState: VictoryAnimationState = {
          data: interpolator.current(eased),
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        };
        stateRef.current = newState;
        setState(newState);
      }, durationRef.current);
    };

    if (delayRef.current) {
      delayTimerId.current = setTimeout(startLoop, delayRef.current);
    } else {
      startLoop();
    }
  }, [timer, getEase]);

  React.useEffect(() => {
    mountedRef.current = true;
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      mountedRef.current = false;
      if (delayTimerId.current !== undefined) {
        clearTimeout(delayTimerId.current);
        delayTimerId.current = undefined;
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

  React.useEffect(() => {
    if (isInitialDataEffect.current) {
      isInitialDataEffect.current = false;
      return;
    }
    runIdRef.current += 1;
    cancelCurrent();
    queue.current = Array.isArray(data) ? [...(data as AnimationStyle[])] : [data as AnimationStyle];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
