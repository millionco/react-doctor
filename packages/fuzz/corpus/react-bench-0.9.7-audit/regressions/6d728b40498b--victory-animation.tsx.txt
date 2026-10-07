// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6d728b40498b6ba7498660b3928c0bf74afe0a8d87d81125c928bae3c5c0daaf
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
  const timer = React.useContext(TimerContext).animationTimer;

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const dataRef = React.useRef(data);
  const prevDataRef = React.useRef(data);
  const queueRef = React.useRef<AnimationStyle[]>([]);
  const interpolatorRef = React.useRef<
    null | ((value: number) => AnimationStyle)
  >(null);
  const loopIDRef = React.useRef<number | undefined>(undefined);
  const timeoutIDRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const currentDataRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  const [state, setState] = React.useState<VictoryAnimationState>({
    data: currentDataRef.current,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  // Keep refs in sync with the latest props so the active animation loop always
  // uses the current duration, easing, delay, and onEnd callback.
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  dataRef.current = data;

  const stopAnimation = React.useCallback(() => {
    if (timeoutIDRef.current) {
      clearTimeout(timeoutIDRef.current);
      timeoutIDRef.current = undefined;
    }
    if (loopIDRef.current) {
      timer.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, [timer]);

  const startAnimation = React.useCallback(() => {
    if (queueRef.current.length === 0) {
      return;
    }

    const nextData = queueRef.current[0];
    interpolatorRef.current = victoryInterpolator(
      currentDataRef.current,
      nextData,
    );

    const run = () => {
      timeoutIDRef.current = undefined;
      const startDuration = durationRef.current;

      loopIDRef.current = timer.subscribe((elapsed) => {
        const currentDuration = durationRef.current;
        const step = currentDuration ? elapsed / currentDuration : 1;
        const ease = d3Ease[formatAnimationName(easingRef.current)];

        if (step >= 1) {
          const finalData = interpolatorRef.current!(1);
          currentDataRef.current = finalData;

          setState({
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });

          if (loopIDRef.current) {
            timer.unsubscribe(loopIDRef.current);
            loopIDRef.current = undefined;
          }

          queueRef.current.shift();

          if (queueRef.current.length === 0) {
            onEndRef.current?.();
          } else {
            startAnimation();
          }
          return;
        }

        const newData = interpolatorRef.current!(ease(step));
        currentDataRef.current = newData;
        setState({
          data: newData,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      }, startDuration);
    };

    if (delayRef.current) {
      timeoutIDRef.current = setTimeout(run, delayRef.current);
    } else {
      run();
    }
  }, [timer]);

  // On mount: initialize the queue from the initial data and begin traversing it.
  React.useEffect(() => {
    const isArray = Array.isArray(dataRef.current);
    currentDataRef.current = isArray
      ? (dataRef.current as AnimationStyle[])[0]
      : (dataRef.current as AnimationStyle);
    queueRef.current = isArray
      ? (dataRef.current as AnimationStyle[]).slice(1)
      : [];

    setState({
      data: currentDataRef.current,
      animationInfo: {
        progress: 0,
        animating: false,
      },
    });

    if (queueRef.current.length > 0) {
      startAnimation();
    }

    return () => stopAnimation();
  }, [startAnimation, stopAnimation]);

  // On data change: abandon the current run, keep the currently rendered style as
  // the starting point, and animate toward the new data.
  React.useEffect(() => {
    if (dataRef.current === prevDataRef.current) {
      return;
    }

    prevDataRef.current = dataRef.current;

    stopAnimation();
    queueRef.current = Array.isArray(dataRef.current)
      ? (dataRef.current as AnimationStyle[])
      : [dataRef.current as AnimationStyle];
    startAnimation();
  }, [data, startAnimation, stopAnimation]);

  return children(state.data, state.animationInfo);
};
