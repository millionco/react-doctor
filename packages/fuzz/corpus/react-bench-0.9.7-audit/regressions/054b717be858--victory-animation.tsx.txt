// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 054b717be858fafd57f59a46ef8d072ffa87309d619350dd065af289a8a26759
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

  /**
   * The animation loop outlives the render that started it, so it must never
   * read `duration`, `easing`, `delay` or `onEnd` from a closure. Keeping the
   * latest values in a ref lets an in-flight run pick up new settings.
   */
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  /**
   * The most recent subscription. Ids are never reused, so unsubscribing one
   * that has already ended is a no-op and cannot cancel another component's
   * loop.
   */
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * Identifies the run that owns the animation loop. Superseding a run bumps
   * this, so any frame, delayed start, or queue step left over from the old run
   * bails out instead of rendering or calling `onEnd` after being replaced.
   */
  const runID = React.useRef(0);
  /**
   * The style currently on screen. Frames can't read `state` (their closure is
   * frozen at subscribe time), and a replacement run must interpolate from
   * whatever is visible right now rather than from a stale starting point.
   */
  const currentData = React.useRef(state.data);

  /** The `data` of the first render, which the mount effect below owns. */
  const initialData = React.useRef<AnimationData | undefined>(data);

  /** Stop the active run, if any, and invalidate everything it scheduled. */
  const cancelActiveRun = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop so completion cannot fire after unmount
    return () => {
      const neverSubscribed = loopID.current === undefined;
      cancelActiveRun();
      if (neverSubscribed) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (data === initialData.current) {
      // Handled by the mount effect, which keeps the first style of an array
      // as the starting point rather than animating towards it.
      return;
    }
    initialData.current = undefined;

    // Hand off from any run still in progress: it is superseded, so it must not
    // render its now-outdated target, and only this replacement may complete.
    cancelActiveRun();
    // Set the tween queue to the new data. Copy it, since traversing shifts.
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue from the currently visible style
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the visible style to the next data
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const subscribe = () => {
        if (id !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, id),
          settings.current.duration,
        );
      };

      // Reset step to zero
      if (settings.current.delay) {
        delayID.current = setTimeout(subscribe, settings.current.delay);
      } else {
        subscribe();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, id: number) => {
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      currentData.current = interpolator.current(1);
      setState({
        data: currentData.current,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(currentEasing)];
    currentData.current = interpolator.current(ease(step));
    setState({
      data: currentData.current,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
