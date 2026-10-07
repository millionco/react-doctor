// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0e4d258aa87adfa2e6a7408a3e12cb686aaceea22d7df0288407fcc941514de8
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
  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);

  // Keep the latest `duration`, `easing`, `onEnd`, and `delay` in refs so that
  // an animation that is already in flight adopts the newest settings on its
  // next frame instead of finishing with whatever values were captured when it
  // started.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // The style that is currently visible. Interpolations always continue from
  // this value so that a mid-run `data` change does not flash to the superseded
  // target.
  const currentData = React.useRef<AnimationStyle>(state.data);
  // A monotonic token identifying the active run. Bumping it invalidates any
  // in-flight run (including delayed starts and queued steps) so a superseded
  // run can neither render nor complete.
  const runID = React.useRef(0);
  // Pending delayed start, tracked so it can be cancelled on handoff/unmount.
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isFirstRender = React.useRef(true);

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const traverseQueue = (runToken: number) => {
    // A superseded run must not continue.
    if (runToken !== runID.current) {
      return;
    }

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to the next target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const startLoop = () => {
        // The run may have been superseded while the delay was pending.
        if (runToken !== runID.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runToken),
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayTimeout.current = setTimeout(startLoop, delayRef.current);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      // Only ever invoke the latest `onEnd` callback.
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, runToken: number) => {
    // Ignore frames belonging to a run that has since been superseded.
    if (runToken !== runID.current || !interpolator.current) {
      return;
    }

    // Adopt the latest duration; `step` can be imprecise and exceed 1, in which
    // case we snap to the final value and advance the queue.
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      setAnimationState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      queue.current.shift();
      traverseQueue(runToken);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState(interpolator.current(easeRef.current(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop so a completion cannot fire after unmount.
    return () => {
      // Invalidate any in-flight run.
      runID.current += 1;
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
    // The initial data is already reflected in state and handled by the mount
    // effect (for array queues); nothing to hand off on the first render.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // A new `data` supersedes any run currently in flight. Invalidate it,
    // cancel its timer and any pending delayed start, then begin a replacement
    // run from the currently visible style toward the new data.
    runID.current += 1;
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
    }
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
