// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 383db7ee6bb576c8388060d3583b978afcc405b6ed99deb900bc0e9ee2e7be4d
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

  // The active run reads these from a ref rather than closing over the props
  // at subscribe-time, so an in-flight animation adopts the latest settings.
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Mirror of the committed state so callbacks can read the currently visible
  // style synchronously (React state updates are async).
  const stateRef = React.useRef(state);

  // Identifies the active run. Bumping it invalidates any superseded run so its
  // pending frames, queued steps, and delayed starts cannot render or complete.
  const generation = React.useRef(0);

  const isFirstRender = React.useRef(true);

  const commit = (next: VictoryAnimationState) => {
    stateRef.current = next;
    setState(next);
  };

  const functionToBeRunEachFrame = (elapsed: number, runID: number) => {
    // A superseded run must not render or complete.
    if (runID !== generation.current || !interpolator.current) return;

    const { duration: currentDuration, easing: currentEasing } =
      settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      commit({
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
      traverseQueue(runID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(currentEasing)];
    commit({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (runID: number) => {
    if (runID !== generation.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target so
      // handing off mid-run never flashes a superseded target.
      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      const startLoop = () => {
        if (runID !== generation.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runID),
          settings.current.duration,
        );
      };

      // Reset step to zero
      if (settings.current.delay) {
        delayTimeout.current = setTimeout(startLoop, settings.current.delay);
      } else {
        startLoop();
      }
    } else if (settings.current.onEnd) {
      // Invoke only the latest callback when the queue completes.
      settings.current.onEnd();
    }
  };

  const cancelActiveRun = () => {
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(generation.current);
    }

    // Clean up the animation loop
    return () => {
      // Invalidate the active run so a queued frame or delayed start that fires
      // after unmount cannot complete the animation.
      generation.current += 1;
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
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
    // The initial run is started by the mount effect above.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Invalidate the in-flight run and cancel its loop / delayed start, then
    // start a replacement run from the currently visible style toward the new
    // data. Only this replacement run will render and complete.
    generation.current += 1;
    const runID = generation.current;
    cancelActiveRun();

    // Set the tween queue to the new data (copied so `shift` never mutates props)
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue(runID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
