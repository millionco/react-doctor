// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 7295b01bb9096a9dd017d977aca6c4f5503206576c29a81cf563623e82f2a017
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const loopID = React.useRef<number | undefined>(undefined);
  const loopTimer = React.useRef<typeof timer | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout>>();
  const animationVersion = React.useRef(0);
  const mounted = React.useRef(false);
  const stateRef = React.useRef(state);
  const previousProps = React.useRef<
    | {
        data: AnimationData;
        duration: number;
        easing: AnimationEasing;
        delay: number;
      }
    | undefined
  >(undefined);
  const onEndRef = React.useRef(onEnd);

  stateRef.current = state;
  onEndRef.current = onEnd;

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    const nextState = { data: nextData, animationInfo };
    stateRef.current = nextState;
    setState(nextState);
  };

  const unsubscribeLoop = () => {
    if (loopID.current !== undefined) {
      loopTimer.current?.unsubscribe(loopID.current);
      loopID.current = undefined;
      loopTimer.current = undefined;
    }
  };

  const cancelAnimation = () => {
    animationVersion.current += 1;
    unsubscribeLoop();
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
  };

  const traverseQueue = (version: number) => {
    if (!mounted.current || version !== animationVersion.current) return;

    const nextData = queue.current[0];
    if (!nextData) {
      onEndRef.current?.();
      return;
    }

    const startData = stateRef.current.data;
    const interpolator = victoryInterpolator(startData, nextData);
    const currentDuration = duration;
    const currentEase = d3Ease[formatAnimationName(easing)];

    setAnimationState(startData, {
      progress: 0,
      animating: true,
    });

    const run = () => {
      if (!mounted.current || version !== animationVersion.current) return;

      loopTimer.current = timer;
      loopID.current = timer.subscribe((elapsed: number) => {
        if (!mounted.current || version !== animationVersion.current) return;

        // Step can generate imprecise values, sometimes greater than 1.
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          setAnimationState(interpolator(1), {
            progress: 1,
            animating: false,
            terminating: true,
          });
          unsubscribeLoop();
          queue.current.shift();
          traverseQueue(version);
          return;
        }

        setAnimationState(interpolator(currentEase(step)), {
          progress: step,
          animating: true,
        });
      }, currentDuration);
    };

    if (delay) {
      delayTimeout.current = setTimeout(() => {
        delayTimeout.current = undefined;
        run();
      }, delay);
    } else {
      run();
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const previous = previousProps.current;
    const isInitialRender = !previous;
    const dataChanged = !isInitialRender && previous.data !== data;
    const settingsChanged =
      !isInitialRender &&
      (previous.duration !== duration ||
        previous.easing !== easing ||
        previous.delay !== delay);

    previousProps.current = { data, duration, easing, delay };

    if (isInitialRender) {
      // The first item is already rendered. Array data supplies the remaining
      // ordered animation queue. Object data retains its historical initial
      // no-op tween, including the timing and onEnd behavior.
      queue.current = Array.isArray(data) ? data.slice(1) : [data];
    } else if (dataChanged) {
      // A replacement always starts from the style currently visible on screen,
      // never from the superseded target.
      cancelAnimation();
      queue.current = Array.isArray(data) ? data.slice() : [data];
    } else if (settingsChanged && queue.current.length) {
      // Restart the current queue step with the latest timing configuration.
      cancelAnimation();
    } else if (
      queue.current.length &&
      loopID.current === undefined &&
      delayTimeout.current === undefined
    ) {
      // React's development Strict Mode replays effects after cleanup. Resume
      // the interrupted queue without treating it as a new animation.
    } else {
      return;
    }

    if (queue.current.length) {
      traverseQueue(animationVersion.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, delay, duration, easing]);

  return children(state.data, state.animationInfo);
};
