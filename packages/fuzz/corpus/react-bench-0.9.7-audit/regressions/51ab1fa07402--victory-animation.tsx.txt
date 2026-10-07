// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 51ab1fa0740286d74317a86db950721310acc986a6558e6c5383ae2fbb7e77c3
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
   * The animation runs outside of the render cycle, so it reads its settings
   * from this ref instead of from the closure it was started in. That way a run
   * which is already in progress finishes using the latest `duration`,
   * `easing`, `delay` and `onEnd` rather than outdated ones.
   */
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * The style that is currently on screen. A run that replaces another one
   * starts here, so the superseded target style is never rendered.
   */
  const currentStyle = React.useRef<AnimationStyle>(state.data);
  /**
   * Identifies the active run. Superseded runs hold an outdated id, which makes
   * their pending frames and delayed starts no-ops, so they can neither render
   * nor complete once they have been handed off.
   */
  const runID = React.useRef(0);
  const isFirstRun = React.useRef(true);

  const applyStyle = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    currentStyle.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  /** Ends the active run so that nothing belonging to it can fire later. */
  const stopActiveRun = () => {
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

  React.useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      // The first entry of array data is the starting style, so it isn't queued.
      queue.current = Array.isArray(data) ? data.slice(1) : [data];
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue(runID.current);
      }
      return;
    }

    // Hand the animation off: the run in progress is abandoned where it is, and
    // a replacement run continues from the visible style toward the new data.
    stopActiveRun();
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      const wasLooping = loopID.current !== undefined;
      stopActiveRun();
      if (!wasLooping) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the visible style to the next step in the queue
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      const startLoop = () => {
        if (id !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, id),
          latestProps.current.duration,
        );
      };

      // Reset step to zero
      if (latestProps.current.delay) {
        delayID.current = setTimeout(startLoop, latestProps.current.delay);
      } else {
        startLoop();
      }
    } else {
      latestProps.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, id: number) => {
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      applyStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
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
    applyStyle(interpolator.current(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  return children(state.data, state.animationInfo);
};
