// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit dfc7c091de889c16cec88e3210279af7ed45add5e71941492b537e8b738f6b93
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
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const hasDataChanged = React.useRef(false);
  const stateRef = React.useRef(state);
  const latestProps = React.useRef({ duration, easing, delay, onEnd });

  stateRef.current = state;
  latestProps.current = { duration, easing, delay, onEnd };

  const setAnimationState = (nextState: VictoryAnimationState) => {
    if (!mounted.current) return;

    stateRef.current = nextState;
    setState(nextState);
  };

  const cancelActiveStep = () => {
    generation.current += 1;

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }

    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    interpolator.current = null;
  };

  const traverseQueue = () => {
    if (!mounted.current) return;

    if (!queue.current.length) {
      interpolator.current = null;
      latestProps.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

    const stepGeneration = ++generation.current;
    const startStep = () => {
      delayID.current = undefined;

      if (!mounted.current || stepGeneration !== generation.current) return;

      loopID.current = timer.subscribe((elapsed: number) => {
        if (
          !mounted.current ||
          stepGeneration !== generation.current ||
          !interpolator.current
        ) {
          return;
        }

        const currentDuration = latestProps.current.duration;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalData = interpolator.current(1);
          const completedLoopID = loopID.current;
          loopID.current = undefined;

          if (completedLoopID !== undefined) {
            timer.unsubscribe(completedLoopID);
          }

          queue.current.shift();
          interpolator.current = null;
          setAnimationState({
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });
          traverseQueue();
          return;
        }

        const currentEase =
          d3Ease[formatAnimationName(latestProps.current.easing)];
        setAnimationState({
          data: interpolator.current(currentEase(step)),
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
      }, latestProps.current.duration);
    };

    if (latestProps.current.delay) {
      delayID.current = setTimeout(startStep, latestProps.current.delay);
    } else {
      startStep();
    }
  };

  React.useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      cancelActiveStep();
      queue.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const isReplacement =
      hasDataChanged.current || previousData.current !== data;

    if (previousData.current !== data) {
      hasDataChanged.current = true;
    }
    previousData.current = data;

    cancelActiveStep();
    if (Array.isArray(data)) {
      queue.current = isReplacement ? [...data] : data.slice(1);
    } else {
      queue.current = isReplacement ? [data] : [];
    }

    // Do not trigger `onEnd` when there is no initial queue to animate.
    if (queue.current.length || isReplacement) {
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
