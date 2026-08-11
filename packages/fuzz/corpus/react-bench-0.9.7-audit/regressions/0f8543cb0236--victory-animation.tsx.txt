// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0f8543cb02364590f74870e49d6ab74a1e48c499e1f93419ec5a9c85244e180f
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
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const stateRef = React.useRef(state);
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

  const clearDelay = React.useCallback(() => {
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
  }, []);

  const cancelLoop = React.useCallback(() => {
    clearDelay();
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [clearDelay, timer]);

  const traverseQueueRef = React.useRef<() => void>(() => {});
  const frameRef = React.useRef<(elapsed: number) => void>(() => {});

  frameRef.current = (elapsed: number) => {
    if (!interpolator.current) return;
    const curDuration = durationRef.current ?? DEFAULT_DURATION;
    const easeName = formatAnimationName(easingRef.current);
    const easeModule = d3Ease as unknown as Record<string, (t: number) => number>;
    const easeFn = easeModule[easeName];

    const step = curDuration ? elapsed / curDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      stateRef.current = {
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      };
      setState(stateRef.current);
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueueRef.current();
      return;
    }

    const eased = easeFn ? easeFn(step) : step;
    const currentData = interpolator.current(eased);
    const nextState: VictoryAnimationState = {
      data: currentData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    };
    stateRef.current = nextState;
    setState(nextState);
  };

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      const start = () => {
        loopID.current = timer.subscribe(
          (elapsed: number) => frameRef.current(elapsed),
          durationRef.current ?? DEFAULT_DURATION,
        );
      };

      if (delayRef.current) {
        clearDelay();
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = undefined;
          start();
        }, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueueRef.current();
    }
    return () => {
      clearDelay();
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
    // Cancel anything in-flight and start replacement run from currently visible style
    cancelLoop();
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
