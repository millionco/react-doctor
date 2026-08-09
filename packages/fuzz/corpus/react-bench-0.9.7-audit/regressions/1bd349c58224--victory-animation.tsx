// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1bd349c5822454d5a2ec47d7cccf8e10df6bfcec0ee060147ceda1537aa8259e
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /**
   * Animation settings are read through a ref so that a run already in
   * progress picks up the latest props instead of the ones captured when it
   * was started.
   */
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  /**
   * The rendered style has to be readable synchronously: a queue step may
   * finish and start the next tween within a single frame, before React has
   * re-rendered with the state from the previous step.
   */
  const stateRef = React.useRef(state);

  /**
   * Identifies the current run. Superseded runs keep a stale token, which lets
   * their pending frames, delayed starts and `onEnd` calls opt out.
   */
  const runID = React.useRef(0);

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  /** Tear down whatever is running and return a token for the new run. */
  const cancelRun = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    runID.current += 1;
    return runID.current;
  };

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      const hadLoop = Boolean(loopID.current);
      cancelRun();
      if (!hadLoop) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Cancel any run still in flight, then tween from the currently visible
    // style toward the new data. The superseded target is never rendered.
    const token = cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (token: number) => {
    if (token !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      const start = () => {
        delayID.current = undefined;
        if (token !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, token),
          settings.current.duration,
        );
      };

      // Reset step to zero
      if (settings.current.delay) {
        delayID.current = setTimeout(start, settings.current.delay);
      } else {
        start();
      }
    } else {
      settings.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, token: number) => {
    if (token !== runID.current) return;
    if (!interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      settings.current;

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
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(token);
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
        animating: true,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
