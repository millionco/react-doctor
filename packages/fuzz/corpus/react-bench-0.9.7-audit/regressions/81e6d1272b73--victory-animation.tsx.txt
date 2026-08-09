// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 81e6d1272b7389474474c0046e46a83d508a55f30f969ef2a775322627906cff
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
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // The most recently rendered ("visible") style. Every animation continues
  // from this value so that changing `data` mid-run never flashes a superseded
  // target, and so array-data queues chain from each reached target.
  const activeData = React.useRef<AnimationStyle>(state.data);

  // "Latest value" refs. The timer holds onto the frame callback from the
  // render that subscribed it, so reading these through refs (rather than
  // through that callback's closure) lets an animation already in flight adopt
  // the most recent `duration`, `easing`, and `onEnd`.
  const ease = d3Ease[formatAnimationName(easing)];
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  durationRef.current = duration;
  easeRef.current = ease;
  onEndRef.current = onEnd;
  delayRef.current = delay;

  // Identifies the run that currently owns the timer. Superseding a run bumps
  // this, so any stale frame callback becomes a no-op that unsubscribes itself.
  const runID = React.useRef(0);

  // The data-change effect below also runs on mount; mount is handled here.
  const isFirstRender = React.useRef(true);

  const commit = (nextData: AnimationStyle, animationInfo: AnimationInfo) => {
    activeData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const startLoop = (thisRun: number) => {
    let localID: number | undefined;

    const functionToBeRunEachFrame = (elapsed: number) => {
      // A superseded run (or one whose interpolator is gone) must neither
      // render nor complete. Unsubscribe *its own* subscription so it can't
      // clobber the run that replaced it.
      if (thisRun !== runID.current || !interpolator.current) {
        if (localID) {
          timer.unsubscribe(localID);
        }
        return;
      }

      // Step can generate imprecise values, sometimes greater than 1; if this
      // happens set the state to 1 and cancel the timer. `duration` is read
      // live so an in-flight animation honors the latest value.
      const currentDuration = durationRef.current;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        commit(interpolator.current(1), {
          progress: 1,
          animating: false,
          terminating: true,
        });
        if (localID) {
          timer.unsubscribe(localID);
        }
        queue.current.shift();
        traverseQueue();
        return;
      }

      // Pass the eased step to the interpolator (cached for performance). Both
      // the easing function and duration are read live from refs.
      commit(interpolator.current(easeRef.current(step)), {
        progress: step,
        animating: step < 1,
      });
    };

    localID = timer.subscribe(functionToBeRunEachFrame, durationRef.current);
    loopID.current = localID;
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(activeData.current, nextData);

      const thisRun = runID.current;
      if (delayRef.current) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          startLoop(thisRun);
        }, delayRef.current);
      } else {
        startLoop(thisRun);
      }
    } else if (onEndRef.current) {
      // Only the run that completes the queue fires `onEnd`, and it uses the
      // latest callback.
      onEndRef.current();
    }
  };

  // Stops whatever this instance currently has scheduled (a pending delayed
  // start and/or an active loop) and neutralizes its frame callback.
  const stopActiveRun = () => {
    runID.current += 1;
    if (timeoutID.current) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop. Bumping the run id ensures a completion
    // cannot fire after unmount even if a frame is already in flight.
    return () => {
      runID.current += 1;
      if (timeoutID.current) {
        clearTimeout(timeoutID.current);
        timeoutID.current = undefined;
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
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Supersede any run in progress, then hand off to the new data continuing
    // from the currently visible style (no flash of the superseded target).
    stopActiveRun();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
