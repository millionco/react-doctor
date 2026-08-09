// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit e60f23d227f63d111b5e184a964985ea86c4ae31d3a839131968cb43072c037c
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import isEqual from "react-fast-compare";

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
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const stateDataRef = React.useRef<AnimationStyle>(state.data);
  const prevDataRef = React.useRef<AnimationData>(data);
  const isFirstDataEffect = React.useRef(true);

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  React.useEffect(() => {
    stateDataRef.current = state.data;
  }, [state.data]);

  const clearTimers = React.useCallback(() => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(() => {
    if (!queue.current.length) {
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(
      stateDataRef.current,
      nextData,
    );

    const startLoop = () => {
      delayTimeoutID.current = undefined;
      loopID.current = timer.subscribe((elapsed: number) => {
        if (!interpolator.current) {
          return;
        }
        const currentDuration = durationRef.current;
        const currentEasing = easingRef.current;
        const easeFn =
          (d3Ease as Record<string, (t: number) => number>)[
            formatAnimationName(currentEasing)
          ] ?? ((t: number) => t);

        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalData = interpolator.current!(1);
          stateDataRef.current = finalData;
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

        const eased = easeFn(step);
        const nextStyle = interpolator.current!(eased);
        stateDataRef.current = nextStyle;
        setState({
          data: nextStyle,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      }, durationRef.current);
    };

    if (delayRef.current) {
      delayTimeoutID.current = setTimeout(startLoop, delayRef.current);
    } else {
      startLoop();
    }
  }, [timer]);

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      if (delayTimeoutID.current !== undefined) {
        clearTimeout(delayTimeoutID.current);
        delayTimeoutID.current = undefined;
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
      prevDataRef.current = data;
      return;
    }
    if (isEqual(prevDataRef.current, data)) {
      return;
    }
    prevDataRef.current = data;
    clearTimers();
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
