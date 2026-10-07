// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 55b82b6fc5dbe4050b2a4e97111f56c1339945fca38544e85182b68891d95562
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
   * The animation loop reads its settings from here rather than from the render
   * that created it, so a run already in progress finishes with the latest
   * props instead of the ones it was started with.
   */
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  /**
   * Mirrors `state` so the loop can read the style currently on screen without
   * being recreated (and resubscribed) on every frame.
   */
  const stateRef = React.useRef(state);

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * Identifies the run that owns the frames currently scheduled. Superseding a
   * run bumps this, which turns any frame it has already scheduled into a
   * no-op, so it can neither render its outgoing target nor call `onEnd`.
   */
  const runID = React.useRef(0);
  /**
   * The `data` as first received, held until it is replaced. When it is an
   * array, its first entry is already rendered as the starting style, so that
   * entry is not animated to.
   */
  const initialData = React.useRef<AnimationData | undefined>(data);

  const updateState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  /** Ends the current run, including a start still waiting on `delay`. */
  const stopRun = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, currentRun: number) => {
    // Frames left over from a superseded run must not render or complete
    if (currentRun !== runID.current || !interpolator.current) return;

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
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(currentRun);
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
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (currentRun: number) => {
    if (currentRun !== runID.current) return;

    if (queue.current.length) {
      // Interpolate from the style on screen, so a run that took over from
      // another picks up where it left off instead of restarting or jumping
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        queue.current[0],
      );

      const startStep = () => {
        delayID.current = undefined;
        if (currentRun !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, currentRun),
          settings.current.duration,
        );
      };

      if (settings.current.delay) {
        delayID.current = setTimeout(startStep, settings.current.delay);
      } else {
        startStep();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  React.useEffect(() => {
    // Clean up the animation loop, so a run in flight cannot complete once
    // this component is gone
    return () => {
      if (loopID.current === undefined) {
        timer.stop();
      }
      stopRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const isInitialData = initialData.current === data;
    if (!isInitialData) {
      // Once superseded, the initial `data` loses its starting-style status, so
      // passing it again later animates to all of it
      initialData.current = undefined;
    }

    // Supersede any run in progress before replacing its target
    stopRun();

    // Set the tween queue to the new data. It is copied because traversing it
    // consumes it.
    queue.current = Array.isArray(data)
      ? data.slice(isInitialData ? 1 : 0)
      : [data];

    // Length check prevents us from triggering `onEnd` in `traverseQueue` when
    // there was nothing to animate to begin with.
    if (!isInitialData || queue.current.length) {
      // Start traversing the tween queue
      traverseQueue(runID.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
