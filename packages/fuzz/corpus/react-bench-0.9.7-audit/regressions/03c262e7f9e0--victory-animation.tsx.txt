// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 03c262e7f9e09a61cd32111f6854930a73c4cf50e1548e30744da23c49bb97f7
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
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // A monotonically increasing token identifying the animation sequence that is
  // currently in effect. Every frame and delayed start is tagged with the token
  // that was active when it was scheduled; if a newer sequence has since started
  // (because `data` changed, or the component unmounted), the stale work is
  // ignored so it can neither render nor complete after being superseded.
  const activeRun = React.useRef(0);

  // The frame callback is subscribed to the timer once per queue step, capturing
  // the values that were current at subscription time. Mirroring the latest
  // props into refs lets an in-progress animation adopt the newest `duration`,
  // `easing`, and `onEnd` instead of finishing with the settings it started with.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  // The most recently rendered style, so that a mid-flight `data` change hands
  // off from what is actually on screen rather than from a stale target.
  const currentData = React.useRef(state.data);

  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;
  currentData.current = state.data;

  const traverseQueue = (runID: number) => {
    // Bail if a newer sequence has taken over since this step was queued.
    if (runID !== activeRun.current) {
      return;
    }
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const start = () => {
        // A delayed start that has been superseded must not begin.
        if (runID !== activeRun.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runID),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayTimeout.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, runID: number) => {
    // Ignore frames belonging to a superseded sequence so it cannot render or
    // complete after a newer `data` value (or an unmount) has taken over.
    if (runID !== activeRun.current || !interpolator.current) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      currentData.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(runID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const nextData = interpolator.current(easeRef.current(step));
    currentData.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Kick off the initial animation sequence. A single-object `data` tweens to
    // itself (a no-op run that still fires `onEnd`), while array `data` walks the
    // remaining entries in order.
    activeRun.current += 1;
    queue.current = Array.isArray(data) ? data.slice(1) : [data];
    traverseQueue(activeRun.current);

    // Clean up the animation loop. Invalidating the run token and cancelling the
    // active timer guarantees an in-flight completion cannot fire after unmount.
    return () => {
      activeRun.current += 1;
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
        delayTimeout.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousData = React.useRef(data);
  React.useEffect(() => {
    // The initial sequence is owned by the mount effect above. Comparing against
    // the previous `data` (rather than a "first run" flag) also makes this a
    // no-op for React 18 StrictMode's remount, which re-invokes effects on mount.
    if (data === previousData.current) {
      return;
    }
    previousData.current = data;

    // `data` changed: hand off from the currently visible style toward the new
    // data. Cancel the superseded run (both a pending delayed start and an
    // active loop) and bump the run token so it can neither render nor complete,
    // then start a fresh sequence — without flashing the previous target.
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    activeRun.current += 1;
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue(activeRun.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
