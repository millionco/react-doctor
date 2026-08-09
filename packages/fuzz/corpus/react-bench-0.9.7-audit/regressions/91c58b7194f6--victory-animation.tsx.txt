// rule: effect-needs-cleanup
// file-path: packages/victory-core/src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 91c58b7194f67a08ee8b941245198ac63acd4552dd3a0f89bf608171818d7e2a
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

type AnimationInterpolator = (value: number) => AnimationStyle;

interface AnimationRun {
  data: AnimationData;
  queue: AnimationStyle[];
  interpolator: AnimationInterpolator;
  loopID?: number;
  timeoutID?: ReturnType<typeof setTimeout>;
}

export const VictoryAnimation = ({
  duration = DEFAULT_DURATION,
  easing = "quadInOut",
  delay = 0,
  data,
  children,
  onEnd,
}: VictoryAnimationProps) => {
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const mounted = React.useRef(false);
  const initialRender = React.useRef(true);
  const currentData = React.useRef<AnimationData>(data);
  const currentStyle = React.useRef<AnimationStyle>(initialData);
  const currentRun = React.useRef<AnimationRun | null>(null);
  const options = React.useRef({ duration, easing, delay, onEnd });

  // These refs let an already-running timer use the latest animation options.
  // The data ref is also updated during render so a stale timer callback cannot
  // render between a prop change and the effect that replaces its run.
  currentData.current = data;
  options.current = { duration, easing, delay, onEnd };

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentStyle.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const isCurrentRun = (run: AnimationRun) => {
    return (
      mounted.current &&
      currentRun.current === run &&
      currentData.current === run.data
    );
  };

  const cancelRun = (run: AnimationRun, stopTimer = false) => {
    if (run.timeoutID !== undefined) {
      clearTimeout(run.timeoutID);
      run.timeoutID = undefined;
    }
    if (run.loopID !== undefined) {
      timer.unsubscribe(run.loopID);
      run.loopID = undefined;
    } else if (stopTimer) {
      timer.stop();
    }
  };

  const cancelCurrentRun = (stopTimer = false) => {
    if (currentRun.current) {
      cancelRun(currentRun.current, stopTimer);
      currentRun.current = null;
    } else if (stopTimer) {
      timer.stop();
    }
  };

  const runFrame = (run: AnimationRun, elapsed: number) => {
    if (!isCurrentRun(run)) return;

    const { duration: currentDuration, easing: currentEasing } =
      options.current;
    // Step can generate imprecise values, sometimes greater than 1. If this
    // happens, set the state to 1 and cancel the current subscription.
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = run.interpolator(1);
      if (run.loopID !== undefined) {
        timer.unsubscribe(run.loopID);
        run.loopID = undefined;
      }
      setAnimationState(finalData, {
        progress: 1,
        animating: false,
        terminating: true,
      });
      run.queue.shift();

      if (run.queue.length) {
        run.interpolator = victoryInterpolator(
          currentStyle.current,
          run.queue[0],
        );
        scheduleNextStep(run);
      } else {
        currentRun.current = null;
        options.current.onEnd?.();
      }
      return;
    }

    const ease = d3Ease[formatAnimationName(currentEasing)] as (
      value: number,
    ) => number;
    setAnimationState(run.interpolator(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const subscribeToRun = (run: AnimationRun) => {
    if (!isCurrentRun(run)) return;
    run.loopID = timer.subscribe(
      (elapsed) => runFrame(run, elapsed),
      options.current.duration,
    );
  };

  const scheduleNextStep = (run: AnimationRun) => {
    if (!isCurrentRun(run)) return;

    if (options.current.delay) {
      run.timeoutID = setTimeout(() => {
        run.timeoutID = undefined;
        subscribeToRun(run);
      }, options.current.delay);
    } else {
      subscribeToRun(run);
    }
  };

  const startRun = (nextQueue: AnimationStyle[], runData: AnimationData) => {
    // Effects for superseded renders can be deferred in concurrent React. Do
    // not let one of those effects cancel or start over the latest run.
    if (currentData.current !== runData) return;

    cancelCurrentRun();

    if (!nextQueue.length) {
      options.current.onEnd?.();
      return;
    }

    const run: AnimationRun = {
      data: runData,
      queue: nextQueue,
      interpolator: victoryInterpolator(currentStyle.current, nextQueue[0]),
    };
    currentRun.current = run;

    // The replacement starts at the style that was actually visible. Keep the
    // delayed-start behavior by leaving it non-animating until its timer starts.
    setState({
      data: currentStyle.current,
      animationInfo: {
        progress: 0,
        animating: !options.current.delay,
      },
    });
    scheduleNextStep(run);
  };

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      initialRender.current = true;
      cancelCurrentRun(true);
    };
    // The timer and refs are intentionally stable for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      // The first item in an array is the initial style; the remaining items
      // retain the established ordered queue behavior. Object data still gets
      // an initial run so load transitions receive their onEnd callback.
      const initialQueue = Array.isArray(data)
        ? data.length > 1
          ? data.slice(1)
          : data.slice()
        : [data];
      startRun(initialQueue, data);
    } else {
      // A changed array is a new ordered queue. Unlike the initial render, all
      // of its items are targets because the current style is already visible.
      startRun(Array.isArray(data) ? data.slice() : [data], data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
