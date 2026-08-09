// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit eb590d3752e81c199273346fcf59c9f0e9e30c8faf6fd8c93be700b48a64e819
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
  const initialData = Array.isArray(data) ? data[0] : data;

  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
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
  // Tracks the value currently being rendered so a new run can pick up from
  // it without waiting for a re-render (which may lag behind ref updates).
  const visibleData = React.useRef<AnimationStyle>(initialData);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Bumped every time a new run supersedes the current one, so callbacks
  // scheduled by the old run (timers, delayed starts) can recognize
  // they're stale and become no-ops.
  const runID = React.useRef(0);
  const isFirstRun = React.useRef(true);

  // Kept as refs (rather than closed-over values) so an animation already in
  // progress picks up the latest duration/easing/onEnd instead of finishing
  // out the settings that were active when it started.
  const durationRef = React.useRef(duration);
  const onEndRef = React.useRef(onEnd);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  durationRef.current = duration;
  onEndRef.current = onEnd;
  easeRef.current = d3Ease[formatAnimationName(easing)];

  const clearTimers = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      const startLoop = () => {
        if (id !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed: number) => functionToBeRunEachFrame(id, elapsed),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delay) {
        delayID.current = setTimeout(startLoop, delay);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (id: number, elapsed: number) => {
    if (id !== runID.current) return;
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalValue = interpolator.current(1);
      visibleData.current = finalValue;
      setState({
        data: finalValue,
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
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const value = interpolator.current(easeRef.current(step));
    visibleData.current = value;
    setState({
      data: value,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop
    return () => {
      // Invalidate any in-flight callbacks so completion can't fire post-unmount.
      runID.current += 1;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial data is already handled by the mount effect above.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    // Supersede any in-progress run. The new run continues interpolating
    // from `visibleData.current` (what's currently on screen) toward the
    // new data, rather than jumping to the old target first.
    runID.current += 1;
    const id = runID.current;
    clearTimers();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
