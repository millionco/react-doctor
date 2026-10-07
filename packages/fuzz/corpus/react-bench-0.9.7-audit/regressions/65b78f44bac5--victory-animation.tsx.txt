// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 65b78f44bac5692e5baed4b07143e3be90ec8c9738f20e5ffbe211223f75ae42
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
  const [state, setStateRaw] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? (data[0] as AnimationStyle) : (data as AnimationStyle),
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  const stateRef = React.useRef<VictoryAnimationState>(state);

  const setState = React.useCallback(
    (newState: VictoryAnimationState) => {
      stateRef.current = newState;
      setStateRaw(newState);
    },
    [],
  );

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const timer = React.useContext(TimerContext).animationTimer;

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = React.useRef(0);

  const initialPropRef = React.useRef<AnimationData>(data);
  const prevDataRef = React.useRef<AnimationData>(data);
  const isFirstDataEffect = React.useRef(true);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const clearCurrent = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeout.current !== null) {
      clearTimeout(delayTimeout.current as any);
      delayTimeout.current = null;
    }
  }, [timer]);

  const getEaseFn = React.useCallback(() => {
    const name = easingRef.current;
    const fnName = formatAnimationName(name);
    const fn = (d3Ease as any)[fnName];
    return typeof fn === "function" ? fn : (t: number) => t;
  }, []);

  const traverseQueue = React.useCallback(() => {
    const thisRun = runId.current;

    if (runId.current !== thisRun) {
      return;
    }

    if (!queue.current.length) {
      if (runId.current !== thisRun) {
        return;
      }
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queue.current[0];

    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

    const startLoop = () => {
      if (runId.current !== thisRun) {
        return;
      }
      delayTimeout.current = null;

      const frame = (elapsed: number) => {
        if (runId.current !== thisRun) {
          return;
        }
        if (!interpolator.current) {
          return;
        }

        const currentDuration = durationRef.current ?? DEFAULT_DURATION;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          if (runId.current !== thisRun) {
            return;
          }
          const finalData = interpolator.current(1);
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
          // Guard against race where queue was replaced
          if (runId.current !== thisRun) {
            return;
          }
          queue.current.shift();
          if (runId.current !== thisRun) {
            return;
          }
          traverseQueue();
          return;
        }

        const easeFn = getEaseFn();
        let eased: number;
        try {
          eased = easeFn(step);
        } catch {
          eased = step;
        }

        if (runId.current !== thisRun) {
          return;
        }

        const interpolated = interpolator.current(eased);

        setState({
          data: interpolated,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      };

      loopID.current = timer.subscribe(frame, durationRef.current);
    };

    const currentDelay = delayRef.current;
    if (currentDelay) {
      delayTimeout.current = setTimeout(
        startLoop,
        currentDelay,
      ) as unknown as ReturnType<typeof setTimeout>;
    } else {
      startLoop();
    }
  }, [timer, getEaseFn, setState]);

  React.useEffect(() => {
    return () => {
      runId.current += 1;
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

  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;

      if (data === initialPropRef.current) {
        queue.current = Array.isArray(data) ? (data as AnimationStyle[]).slice(1) : [];
        prevDataRef.current = data;
        if (queue.current.length) {
          traverseQueue();
        }
      } else {
        runId.current += 1;
        clearCurrent();
        queue.current = Array.isArray(data) ? [...(data as AnimationStyle[])] : [data as AnimationStyle];
        prevDataRef.current = data;
        traverseQueue();
      }
      return;
    }

    if (prevDataRef.current === data) {
      return;
    }
    prevDataRef.current = data;

    runId.current += 1;
    clearCurrent();
    queue.current = Array.isArray(data) ? [...(data as AnimationStyle[])] : [data as AnimationStyle];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
