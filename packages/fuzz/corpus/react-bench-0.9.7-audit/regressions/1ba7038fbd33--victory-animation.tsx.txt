// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1ba7038fbd33c93e3426415c41929e8efda17b67d664f9782dab2d4e833dc406
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
  const activeDelay = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The last style we actually rendered. Interpolation always resumes from
  // here so that a run picking up mid-animation continues from the currently
  // visible style rather than jumping to a superseded target.
  const lastData = React.useRef<AnimationStyle>(state.data);
  // Monotonic id identifying the current run. Bumping it invalidates any
  // pending delayed start so a superseded run can never begin.
  const runID = React.useRef(0);

  // Mirror the latest props into refs so the animation loop (which is
  // subscribed once and outlives individual renders) always reads the current
  // `duration`, `easing`, and `onEnd` instead of the values captured when it
  // was subscribed.
  const ease = d3Ease[formatAnimationName(easing)];
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  const timerRef = React.useRef(timer);
  durationRef.current = duration;
  easeRef.current = ease;
  onEndRef.current = onEnd;
  delayRef.current = delay;
  timerRef.current = timer;

  // `traverseQueue` and `functionToBeRunEachFrame` reference each other. This
  // ref breaks the cycle while keeping both callbacks stable identities.
  const traverseQueueRef = React.useRef<() => void>();

  const functionToBeRunEachFrame = React.useCallback((elapsed: number) => {
    if (!interpolator.current) return;

    // Read the latest duration so an in-progress animation adopts prop changes.
    const currentDuration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      lastData.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timerRef.current.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueueRef.current?.();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const stepData = interpolator.current(easeRef.current(step));
    lastData.current = stepData;
    setState({
      data: stepData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  }, []);

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Resume interpolation from the currently visible style.
      interpolator.current = victoryInterpolator(lastData.current, nextData);

      // Tag this run so a delayed start belonging to a superseded run is
      // ignored once it fires.
      const currentRunID = ++runID.current;
      const startLoop = () => {
        activeDelay.current = undefined;
        if (currentRunID !== runID.current) return;
        loopID.current = timerRef.current.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      if (delayRef.current) {
        activeDelay.current = setTimeout(startLoop, delayRef.current);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  }, [functionToBeRunEachFrame]);
  traverseQueueRef.current = traverseQueue;

  // Cancel the active run: stop the loop, drop any pending delayed start, and
  // invalidate its run id so nothing from it can render or complete later.
  const cancelActiveRun = React.useCallback(() => {
    runID.current++;
    if (activeDelay.current) {
      clearTimeout(activeDelay.current);
      activeDelay.current = undefined;
    }
    if (loopID.current) {
      timerRef.current.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, []);

  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop so a completion can't fire after unmount.
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The mount effect above already kicked off the initial queue.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Data changed mid-flight: abandon the superseded run (without flashing its
    // target) and start a replacement that continues from the visible style.
    cancelActiveRun();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
