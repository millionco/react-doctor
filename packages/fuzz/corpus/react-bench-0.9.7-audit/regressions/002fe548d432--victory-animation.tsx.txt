// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 002fe548d43234a4e6c6f71763a0b21a5bd942d82bd4f540810f8fab199ab37d
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
  const mounted = React.useRef(false);
  const visibleData = React.useRef(state.data);
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);
  const lastData = React.useRef(data);

  // Timer callbacks can outlive the render that created them. Keep the
  // settings they use current without restarting an animation from its
  // beginning.
  durationRef.current = duration;
  delayRef.current = delay;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  const setAnimationState = (nextState: VictoryAnimationState) => {
    visibleData.current = nextState.data;
    setState(nextState);
  };

  const functionToBeRunEachFrame = (elapsed: number, currentRun: number) => {
    if (
      !mounted.current ||
      currentRun !== runID.current ||
      !interpolator.current
    ) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1. If this
    // happens set the state to 1 and return, cancelling the timer.
    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      setAnimationState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      interpolator.current = null;

      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }

      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing the
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are
    // received.
    setAnimationState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = () => {
    if (!mounted.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Start each queued step from the style that was actually rendered by
      // the previous step. This is especially important when a new data prop
      // arrives while another step is still running.
      interpolator.current = victoryInterpolator(visibleData.current, nextData);
      const currentRun = runID.current;

      const subscribe = () => {
        if (
          !mounted.current ||
          currentRun !== runID.current ||
          !queue.current.length
        ) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, currentRun),
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          subscribe();
        }, delayRef.current);
      } else {
        subscribe();
      }
    } else {
      const callback = onEndRef.current;
      if (callback) {
        callback();
      }
    }
  };

  const cancelAnimation = (stopTimer = false) => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }

    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    } else if (stopTimer) {
      timer.stop();
    }

    interpolator.current = null;
  };

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length && !interpolator.current) {
      traverseQueue();
    }
    return () => {
      mounted.current = false;
      runID.current += 1;
      cancelAnimation(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial array describes an ordered queue whose first item is the
    // initial style. Subsequent data changes replace that queue and begin from
    // the currently visible style.
    if (!mounted.current) {
      return;
    }

    if (lastData.current === data) {
      return;
    }
    lastData.current = data;

    runID.current += 1;
    cancelAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];

    if (queue.current.length) {
      setAnimationState({
        data: visibleData.current,
        animationInfo: {
          progress: 0,
          animating: true,
        },
      });
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
