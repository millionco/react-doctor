// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 39fa3007b48073daf578d7a52a5b934de548e6d1dd29cae988c922e5ff4f10aa
import React from "react";
import isEqual from "react-fast-compare";
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
   * Identifies the animation run that owns the active timer. New data (or an
   * unmount) increments it, so callbacks scheduled by a superseded run can tell
   * that they no longer own the animation and bail out without rendering or
   * completing.
   */
  const runID = React.useRef(0);

  /** Whether the initially rendered data has yet to be animated away from. */
  const isFirstRun = React.useRef(true);

  /** The data the active animation is targeting. */
  const animatedData = React.useRef<AnimationData>(data);

  /**
   * The style that is currently rendered. Animations always continue from here,
   * so replacing the data mid-animation doesn't flash the abandoned target.
   */
  const currentStyle = React.useRef<AnimationStyle>(state.data);

  /**
   * The latest props, so that a running animation picks up prop changes instead
   * of finishing with the values it started with.
   */
  const latestProps = React.useRef({ duration, easing, delay, onEnd });
  latestProps.current = { duration, easing, delay, onEnd };

  /** Cancel any pending work belonging to the active animation run. */
  const stopAnimation = () => {
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayID.current) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    // A newer animation has taken over; this run is done rendering.
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      const subscribe = () => {
        if (id !== runID.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, id),
          latestProps.current.duration,
        );
      };

      // Reset step to zero
      if (latestProps.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          subscribe();
        }, latestProps.current.delay);
      } else {
        subscribe();
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, id: number) => {
    if (id !== runID.current) return;
    if (!interpolator.current) return;

    // Read the duration and easing on every frame so that prop changes apply to
    // the animation that is already in progress
    const { duration: currentDuration, easing: currentEasing } =
      latestProps.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      currentStyle.current = interpolator.current(1);
      setState({
        data: currentStyle.current,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      stopAnimation();
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    currentStyle.current = interpolator.current(ease(step));
    setState({
      data: currentStyle.current,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Clean up the animation loop, and make sure no queued callback can render
    // or complete after this component is gone
    return () => {
      runID.current += 1;
      // Effects may be re-run after cleanup (e.g. in StrictMode), in which case
      // the rendered style is still the first entry of array data
      isFirstRun.current = true;
      if (delayID.current) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // A re-render with equivalent data isn't a new target, so let the animation
    // in progress carry on (it already picks up other prop changes).
    const isRunning =
      loopID.current !== undefined || delayID.current !== undefined;
    if (isRunning && isEqual(animatedData.current, data)) {
      return;
    }
    animatedData.current = data;

    // Supersede the animation in progress: it must not render or complete, and
    // the new animation continues from the style that is currently visible
    // rather than jumping to the abandoned target.
    stopAnimation();
    const id = (runID.current += 1);

    // Set the tween queue to the new data. On mount the first entry of array
    // data is already rendered, so only the remaining entries are queued.
    const firstRun = isFirstRun.current;
    isFirstRun.current = false;

    if (Array.isArray(data)) {
      queue.current = firstRun ? data.slice(1) : [...data];
      // Length check prevents us from triggering `onEnd` in `traverseQueue`
      // when there is nothing left to animate towards on mount.
      if (firstRun && !queue.current.length) return;
    } else {
      queue.current = [data];
    }

    // Start traversing the tween queue
    traverseQueue(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
