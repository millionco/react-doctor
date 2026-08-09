// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5489e66536e2c5847662bf96ea1d09740a394fcaab30fb963ea697c7a4cd9a41
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

// Optional flushSync to force intermediate milestones to flush before next tween.
// We resolve it dynamically to avoid hard dependency on react-dom (important for RN).
let flushSyncFn: ((cb: () => void) => void) | undefined;
try {
  const g: any = typeof globalThis !== "undefined" ? (globalThis as any) : {};
  if (g.ReactDOM && typeof g.ReactDOM.flushSync === "function") {
    flushSyncFn = g.ReactDOM.flushSync;
  } else {
    // Use eval to avoid static require detection by TS / bundlers
    // eslint-disable-next-line no-eval
    const maybeRequire: any = eval("typeof require !== 'undefined' ? require : undefined");
    if (maybeRequire) {
      try {
        const rd = maybeRequire("react-dom");
        if (rd && typeof rd.flushSync === "function") {
          flushSyncFn = rd.flushSync;
        }
      } catch {
        // ignore - react-dom not available
      }
    }
  }
} catch {
  flushSyncFn = undefined;
}

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
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stateRef = React.useRef<VictoryAnimationState>(state);
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const runIdRef = React.useRef(0);
  const isFirstDataEffect = React.useRef(true);

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  React.useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  React.useEffect(() => {
    easingRef.current = easing;
  }, [easing]);

  React.useEffect(() => {
    delayRef.current = delay;
  }, [delay]);

  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const clearCurrent = React.useCallback(() => {
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current as unknown as number);
      delayTimeout.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length === 0) {
      const cb = onEndRef.current;
      if (cb) {
        cb();
      }
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

    const myRunId = runIdRef.current;
    const currentDelay = delayRef.current ?? 0;
    const currentDuration = durationRef.current ?? DEFAULT_DURATION;

    const doSubscribe = () => {
      if (myRunId !== runIdRef.current) {
        return;
      }
      delayTimeout.current = undefined;
      loopID.current = timer.subscribe((elapsed: number) => {
        if (myRunId !== runIdRef.current) {
          return;
        }
        if (!interpolator.current) {
          return;
        }

        const latestDuration = durationRef.current ?? DEFAULT_DURATION;
        const step = latestDuration ? elapsed / latestDuration : 1;

        if (step >= 1) {
          const finalData = interpolator.current(1);
          const finalState: VictoryAnimationState = {
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          };
          stateRef.current = finalState;
          const isIntermediate = queue.current.length > 1;
          if (isIntermediate && flushSyncFn) {
            try {
              flushSyncFn(() => setState(finalState));
            } catch {
              setState(finalState);
            }
          } else {
            setState(finalState);
          }
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          queue.current.shift();
          traverseQueue();
          return;
        }

        const easingName = easingRef.current ?? "quadInOut";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const easeFn = (d3Ease as any)[formatAnimationName(easingName)] as
          | ((t: number) => number)
          | undefined;
        const ease = typeof easeFn === "function" ? easeFn : (t: number) => t;
        const eased = ease(step);
        const currentData = interpolator.current(eased);
        const newState: VictoryAnimationState = {
          data: currentData,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        };
        stateRef.current = newState;
        setState(newState);
      }, currentDuration);
    };

    if (currentDelay) {
      delayTimeout.current = setTimeout(
        doSubscribe,
        currentDelay,
      ) as unknown as ReturnType<typeof setTimeout>;
    } else {
      doSubscribe();
    }
  }, [timer]);

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      runIdRef.current++;
      if (delayTimeout.current !== undefined) {
        clearTimeout(delayTimeout.current as unknown as number);
        delayTimeout.current = undefined;
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
      return;
    }
    runIdRef.current++;
    clearCurrent();
    queue.current = Array.isArray(data)
      ? ([...data] as AnimationStyle[])
      : [data as AnimationStyle];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
