// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 995cb208cb7b59c4991ab7b30e24a39287f486e3652e2920d887abcb87c3c14f
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
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /**
   * Identifies the currently active run. Every time `data` changes we start a
   * new run, and any frame callback or delayed start belonging to a superseded
   * run becomes a no-op: it must not render, advance the queue, or call
   * `onEnd`.
   */
  const runID = React.useRef(0);

  /**
   * Mirrors the rendered state so that the animation loop always tweens from
   * the style that is currently visible, rather than from a value captured by
   * a stale render closure.
   */
  const stateRef = React.useRef(state);

  /**
   * Latest props, so that an in-flight animation picks up new `duration`,
   * `easing`, `delay` and `onEnd` values instead of the ones it started with.
   */
  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const stopLoop = () => {
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (!queue.current.length) {
      propsRef.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];

    // Interpolate from the currently visible style to the next queued style
    interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

    const subscribe = () => {
      if (id !== runID.current) return;
      delayTimeout.current = undefined;
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, id),
        propsRef.current.duration,
      );
    };

    if (propsRef.current.delay) {
      delayTimeout.current = setTimeout(subscribe, propsRef.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, id: number) => {
    // Ignore frames belonging to a run that has already been superseded
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      propsRef.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      updateState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      stopLoop();
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(currentEasing)];
    updateState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const isFirstRun = React.useRef(true);

  React.useEffect(() => {
    // Cancel the in-flight run (if any) and hand off to a replacement run that
    // starts from the currently visible style. The superseded run is discarded
    // without rendering its target style or firing its `onEnd`.
    stopLoop();
    runID.current += 1;

    if (isFirstRun.current) {
      isFirstRun.current = false;
      // On mount the first entry of array data is already the rendered style,
      // so only the remaining entries need to be animated through.
      queue.current = Array.isArray(data) ? data.slice(1) : [data];
    } else {
      queue.current = Array.isArray(data) ? data.slice() : [data];
    }

    // A length check prevents us from triggering `onEnd` for an empty queue.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Clean up the animation loop on unmount so completion cannot fire afterwards
  React.useEffect(() => {
    return () => {
      runID.current += 1;
      stopLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
