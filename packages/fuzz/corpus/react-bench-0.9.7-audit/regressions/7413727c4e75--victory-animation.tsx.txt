// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 7413727c4e75d2013b58d04afd88e818834241070d703d300ba0cdbbae59346a
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

  // We need to keep latest props and state in a ref to avoid stale closures
  // inside timer callbacks and timeouts.
  const latestRef = React.useRef({
    duration,
    easing,
    onEnd,
    data,
    delay,
    stateData: state.data,
  });

  // Always update the ref with latest props during render
  latestRef.current = {
    ...latestRef.current,
    duration,
    easing,
    onEnd,
    data,
    delay,
  };

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clearTimerAndTimeout = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
  };

  // Safe traverse that always reads from latest ref
  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      const startData = latestRef.current.stateData;

      interpolator.current = victoryInterpolator(startData, nextData);

      const startTimer = () => {
        loopID.current = timer.subscribe((elapsed: number) => {
          if (!interpolator.current) return;

          const currentDuration = latestRef.current.duration;
          const currentEasing = latestRef.current.easing;

          const step = currentDuration ? elapsed / currentDuration : 1;
          const ease = d3Ease[formatAnimationName(currentEasing)];

          if (step >= 1) {
            const finalData = interpolator.current(1);
            latestRef.current.stateData = finalData;

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
            traverseQueue();
            return;
          }

          const nextData = interpolator.current(ease(step));
          latestRef.current.stateData = nextData;

          setState({
            data: nextData,
            animationInfo: {
              progress: step,
              animating: step < 1,
            },
          });
        }, latestRef.current.duration);
      };

      if (latestRef.current.delay) {
        timeoutID.current = setTimeout(startTimer, latestRef.current.delay);
      } else {
        startTimer();
      }
    } else if (latestRef.current.onEnd) {
      latestRef.current.onEnd();
    }
  }, [timer]);

  // Initial mount
  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      const hadLoop = loopID.current !== undefined;
      clearTimerAndTimeout();
      if (!hadLoop) {
        timer.stop();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On data change
  const initialMount = React.useRef(true);
  React.useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }

    clearTimerAndTimeout();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return children(state.data, state.animationInfo);
};
