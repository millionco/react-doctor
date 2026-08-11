// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d2afbf092e84be28a84f694dec939b4c02c126047d6c31ccc5b4d0e4fd8e0858
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
  // The styles left to animate to. The first entry of array data is the style
  // that is rendered initially, so only the entries after it are queued.
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const previousData = React.useRef<AnimationData>(data);
  /**
   * The style that is currently rendered, which is where the next animation
   * has to start from.
   */
  const currentData = React.useRef<AnimationStyle>(state.data);
  /**
   * Each step of the queue is given an id, and only frames belonging to the
   * active step may render or complete. Steps that have been superseded (by new
   * `data`, or by unmounting) are dropped instead of finishing with values that
   * are no longer wanted.
   */
  const activeStepID = React.useRef<number | null>(null);
  const stepCount = React.useRef(0);

  const ease = d3Ease[formatAnimationName(easing)];
  /**
   * Animations are driven by a timer that lives outside of the React
   * lifecycle, so the running animation reads its settings from this ref. That
   * way frames that have not run yet use the latest props, rather than the
   * props that happened to be current when the animation started.
   */
  const settings = React.useRef({ duration, delay, ease, onEnd });
  settings.current = { duration, delay, ease, onEnd };

  const updateState = (nextState: VictoryAnimationState) => {
    currentData.current = nextState.data;
    setState(nextState);
  };

  /**
   * Cancels the animation in progress, if any. Frames belonging to it will no
   * longer render or complete.
   */
  const stopActiveStep = () => {
    activeStepID.current = null;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop, so that it cannot complete after unmounting
    return () => {
      const hasActiveLoop = loopID.current !== undefined;
      stopActiveStep();
      if (!hasActiveLoop) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // This effect also runs on mount, when the initial queue has just been set
    // up above and there is nothing to hand off from.
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Cancel the animation in progress. Its remaining frames must not render
    // or call `onEnd`, as this animation replaces it.
    stopActiveStep();
    // Set the tween queue to the new data. The queue is consumed as the
    // animation runs, so array data is copied rather than mutated.
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue from the style that is rendered now, so
    // that the animation continues where the previous one left off
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (!queue.current.length) {
      // Nothing is animating any more. `onEnd` may synchronously start the next
      // animation, so the active step is cleared before calling it.
      const { onEnd: onEndCallback } = settings.current;
      activeStepID.current = null;
      if (onEndCallback) {
        onEndCallback();
      }
      return;
    }

    const nextData = queue.current[0];

    // Compare the currently rendered style to the next style in the queue
    interpolator.current = victoryInterpolator(currentData.current, nextData);

    stepCount.current += 1;
    const stepID = stepCount.current;
    activeStepID.current = stepID;

    const subscribe = () => {
      delayID.current = undefined;
      // Bail out if this step was superseded while its delay was pending
      if (activeStepID.current !== stepID) return;
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, stepID),
        settings.current.duration,
      );
    };

    // A delay is waited out before every animation, including queued steps
    if (settings.current.delay) {
      delayID.current = setTimeout(subscribe, settings.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, stepID: number) => {
    // Ignore frames belonging to a step that has been superseded or finished
    if (activeStepID.current !== stepID || !interpolator.current) return;

    // Use the latest settings, so that props received mid-animation apply to
    // the rest of the animation
    const { duration: activeDuration, ease: activeEase } = settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

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
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    updateState({
      data: interpolator.current(activeEase(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
