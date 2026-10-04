// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 8c42caa6380b797b67d2414ba4179bfe4118ed75ee1ede769227979a763179c2
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
   * The style that is currently rendered. Animations always start from here, so
   * that a run replacing another one continues from what is on screen instead of
   * jumping to the target it superseded.
   */
  const currentData = React.useRef<AnimationStyle>(state.data);
  /**
   * Identifies the run that a frame or a delayed start belongs to. Superseded
   * runs are abandoned: their frames neither render nor call `onEnd`.
   */
  const runID = React.useRef(0);
  const ease = d3Ease[formatAnimationName(easing)];
  /**
   * Animations read their settings from here rather than from the props they
   * were started with, so that a run in progress finishes with current props.
   */
  const settings = React.useRef({ duration, delay, ease, onEnd });
  settings.current = { duration, delay, ease, onEnd };

  React.useEffect(() => {
    // Clean up the animation loop, so that a pending or in progress run cannot
    // render or complete once this component is gone
    return () => {
      abandonRun();
      if (!loopID.current) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Give up on the run in progress, if any. It animates towards data that is
    // now outdated, and its settings may be outdated too.
    abandonRun();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue, continuing from the rendered style
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /** Stop the current run without rendering or completing it. */
  const abandonRun = () => {
    // Invalidates the frames and the delayed start of the current run
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
    }
  };

  const traverseQueue = () => {
    if (!queue.current.length) {
      interpolator.current = null;
      // Only the latest `onEnd` should hear about the queue completing
      settings.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];

    // Compare the currently rendered style to next props
    interpolator.current = victoryInterpolator(currentData.current, nextData);

    // Claim this run, so that its frames know they are still wanted
    const currentRunID = (runID.current += 1);
    const subscribe = () => {
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, currentRunID),
        settings.current.duration,
      );
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(() => {
        // This run may have been abandoned while it was waiting to start
        if (currentRunID !== runID.current) return;
        delayID.current = undefined;
        subscribe();
      }, settings.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, currentRunID: number) => {
    // Frames belonging to an abandoned run must not render or complete
    if (currentRunID !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, ease: currentEase } = settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      renderStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      // Rendering may have handed the component over to a newer run, which
      // owns the queue from here on
      if (currentRunID !== runID.current) return;

      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current = queue.current.slice(1);
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    renderStyle(interpolator.current(currentEase(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  /** Render an interpolated style, remembering it as the style on screen. */
  const renderStyle = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  return children(state.data, state.animationInfo);
};
