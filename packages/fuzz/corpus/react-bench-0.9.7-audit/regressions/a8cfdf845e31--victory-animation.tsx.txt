// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit a8cfdf845e312bbe20b110d8f252c805bf745153b3a12ae3d0a313b864e4d81d
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
  const delayID = React.useRef<number | undefined>(undefined);
  const ease = d3Ease[formatAnimationName(easing)];

  // Always-latest refs, so a run in progress picks up new settings on its
  // very next frame instead of finishing out with the values it started with.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  React.useEffect(() => {
    durationRef.current = duration;
    easeRef.current = ease;
    delayRef.current = delay;
    onEndRef.current = onEnd;
  });

  // Bumped every time the active run is replaced, so callbacks scheduled by a
  // superseded run (an in-flight frame, or a pending delayed start) know to
  // no-op instead of rendering or completing.
  const runID = React.useRef(0);

  const stopActiveRun = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (thisRunID: number, currentData: AnimationStyle) => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(currentData, nextData);

      const start = () => {
        if (thisRunID !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(thisRunID, elapsed),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          start();
        }, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const startRun = (currentData: AnimationStyle, newQueue: AnimationStyle[]) => {
    stopActiveRun();
    runID.current += 1;
    queue.current = newQueue;
    traverseQueue(runID.current, currentData);
  };

  const isInitialRender = React.useRef(true);

  React.useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue(runID.current, state.data);
      }
    } else {
      // Continue from whatever is currently visible toward the new data,
      // replacing any remaining queued steps, so a superseded target is
      // never rendered.
      startRun(state.data, Array.isArray(data) ? data : [data]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Clean up the animation loop on unmount
  React.useEffect(() => stopActiveRun, []); // eslint-disable-line react-hooks/exhaustive-deps

  const functionToBeRunEachFrame = (thisRunID: number, elapsed: number) => {
    if (thisRunID !== runID.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      traverseQueue(thisRunID, finalData);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
