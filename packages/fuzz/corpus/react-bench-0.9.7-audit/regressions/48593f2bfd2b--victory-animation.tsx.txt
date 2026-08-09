// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 48593f2bfd2b86470265b2d9f9c560059da8b505659539d29a8a5ee3963de7e3
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const didMount = React.useRef(false);
  const previousProps = React.useRef({ data, duration, easing, delay });
  const stateRef = React.useRef(state);
  const onEndRef = React.useRef(onEnd);

  stateRef.current = state;
  onEndRef.current = onEnd;

  const setAnimationState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const cancelAnimation = () => {
    runID.current += 1;
    interpolator.current = null;

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = () => {
    if (!queue.current.length) return;

    // Keep the current target at the front of the queue until it completes.
    // That lets a prop change restart from the visible value without ever
    // showing the target from the superseded animation.
    interpolator.current = victoryInterpolator(
      stateRef.current.data,
      queue.current[0],
    );
    const currentRunID = ++runID.current;
    const ease = d3Ease[formatAnimationName(easing)];

    setAnimationState({
      data: stateRef.current.data,
      animationInfo: {
        progress: 0,
        animating: true,
      },
    });

    const functionToBeRunEachFrame = (elapsed: number) => {
      if (currentRunID !== runID.current || !interpolator.current) return;

      // Step can generate imprecise values, sometimes greater than 1.
      const step = duration ? elapsed / duration : 1;

      if (step >= 1) {
        setAnimationState({
          data: interpolator.current(1),
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
        interpolator.current = null;

        if (queue.current.length) {
          traverseQueue();
        } else {
          onEndRef.current?.();
        }
        return;
      }

      // Pass the eased step to the interpolator while exposing the raw
      // progress to children, matching the public animation contract.
      setAnimationState({
        data: interpolator.current(ease(step)),
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    const subscribe = () => {
      if (currentRunID !== runID.current) return;
      delayID.current = undefined;
      loopID.current = timer.subscribe(functionToBeRunEachFrame, duration);
    };

    if (delay) {
      delayID.current = setTimeout(subscribe, delay);
    } else {
      subscribe();
    }
  };

  React.useEffect(() => {
    const previous = previousProps.current;
    const dataChanged = previous.data !== data;
    const settingsChanged =
      previous.duration !== duration ||
      previous.easing !== easing ||
      previous.delay !== delay;

    previousProps.current = { data, duration, easing, delay };

    if (!didMount.current) {
      didMount.current = true;
      if (queue.current.length) {
        traverseQueue();
      }
      return;
    }

    if (!dataChanged && !settingsChanged) return;

    cancelAnimation();
    if (dataChanged) {
      queue.current = Array.isArray(data) ? data.slice() : [data];
    }
    if (queue.current.length) {
      traverseQueue();
    }
    // `traverseQueue` intentionally uses the latest render's timing settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, duration, easing, delay]);

  React.useEffect(() => {
    return cancelAnimation;
    // The timer comes from context and is stable for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
