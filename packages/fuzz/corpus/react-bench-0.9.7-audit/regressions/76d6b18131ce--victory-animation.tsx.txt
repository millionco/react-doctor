// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 76d6b18131ce15c1905640faa9b8dba4bf2da919bdc5fff2f6f2cbf908d7f98c
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

  const ease = d3Ease[formatAnimationName(easing)];

  // Keep the latest animation settings in refs so that an already-running
  // animation (whose timer callback was created with an earlier closure)
  // always reads the most recent values.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  durationRef.current = duration;
  easeRef.current = ease;
  onEndRef.current = onEnd;
  delayRef.current = delay;

  // The currently visible style. Kept in a ref so callbacks always start the
  // next interpolation from what is actually on screen, without relying on the
  // (potentially stale) captured `state`.
  const currentData = React.useRef(state.data);

  // A monotonically increasing token identifying the active run. Any change to
  // `data` (or an unmount) bumps this token, which invalidates every callback
  // belonging to a superseded run so it can neither render nor complete later.
  const activeRun = React.useRef(0);

  // Tracks whether the initial mount effect has run so the `data` effect can
  // skip the first render (handled by the mount effect instead).
  const mounted = React.useRef(false);

  const setAnimationState = (next: VictoryAnimationState) => {
    currentData.current = next.data;
    setState(next);
  };

  const traverseQueue = (runToken: number) => {
    if (runToken !== activeRun.current) {
      return;
    }
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const start = () => {
        if (runToken !== activeRun.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runToken),
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

  const functionToBeRunEachFrame = (elapsed: number, runToken: number) => {
    // A superseded run must not render or complete.
    if (runToken !== activeRun.current || !interpolator.current) {
      return;
    }

    const currentDuration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setAnimationState({
        data: interpolator.current(1),
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
      traverseQueue(runToken);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    const runToken = (activeRun.current += 1);
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runToken);
    }
    mounted.current = true;

    // Clean up the animation loop
    return () => {
      // Invalidate any in-flight run so a pending frame can't fire after unmount
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

  React.useEffect(() => {
    // The initial mount is handled by the mount effect above.
    if (!mounted.current) {
      return;
    }

    // Invalidate the previous run so it can neither render nor complete, then
    // tear down its timer and any pending delayed start.
    const runToken = (activeRun.current += 1);
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    // Set the tween queue to the new data and start traversing it from the
    // currently visible style — no flash of the superseded target.
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(runToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
