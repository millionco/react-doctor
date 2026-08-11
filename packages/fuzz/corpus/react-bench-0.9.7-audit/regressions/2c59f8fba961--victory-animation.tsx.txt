// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2c59f8fba9616f424b8531ee51db98847777c7197004c522e67f99f1e1ac61a0
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
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const visibleData = React.useRef(state.data);
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const mounted = React.useRef(false);
  const runID = React.useRef(0);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const cancelRun = () => {
    runID.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];
      const interpolator = victoryInterpolator(visibleData.current, nextData);

      const subscribe = () => {
        if (id !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed: number) => {
            if (id !== runID.current) return;

            const currentDuration = durationRef.current;
            const step = currentDuration ? elapsed / currentDuration : 1;

            // Step can generate imprecise values, sometimes greater than 1.
            if (step >= 1) {
              visibleData.current = interpolator(1);
              setState({
                data: visibleData.current,
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
              traverseQueue(id);
              return;
            }

            const ease = d3Ease[formatAnimationName(easingRef.current)];
            visibleData.current = interpolator(ease(step));
            setState({
              data: visibleData.current,
              animationInfo: {
                progress: step,
                animating: true,
              },
            });
          },
          currentDuration,
        );
      };

      if (delayRef.current) {
        delayID.current = setTimeout(subscribe, delayRef.current);
      } else {
        subscribe();
      }
    } else {
      onEndRef.current?.();
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    traverseQueue(runID.current);

    // Clean up the animation loop
    return () => {
      mounted.current = false;
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!mounted.current) return;

    cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
