// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c0320c0472f4a3c6c508bed35f5c3daa61ec33f70d512e6c9852b95052349ea3
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import Timer from "../victory-util/timer";

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

/**
 * All of the mutable state a single running animation needs. It is kept on a
 * ref (rather than closed over in render scope) so that the animation loop and
 * queue traversal always read the *latest* values. This lets an in-progress
 * animation adopt updated `duration`, `easing`, and `onEnd` props, and lets us
 * cleanly hand off to a replacement run when `data` changes.
 */
interface AnimationInstance {
  /** Targets still to animate towards, in order. */
  queue: AnimationStyle[];
  /** Interpolates from the currently visible style to the current target. */
  interpolator: null | ((value: number) => AnimationStyle);
  /** Active timer subscription id, if a frame loop is running. */
  loopID: number | undefined;
  /** Pending delayed-start timeout id, if a start is waiting on `delay`. */
  timeoutID: ReturnType<typeof setTimeout> | undefined;
  /** The most recently rendered (visible) style. */
  currentData: AnimationStyle;
  /** Identifies the active run; superseded runs carry an older value. */
  generation: number;
  /** The last `data` prop we started animating, used to detect real changes. */
  lastData: AnimationData;
  // Latest props/settings, refreshed on every render:
  duration: number;
  ease: (value: number) => number;
  delay: number;
  onEnd: (() => void) | undefined;
  timer: Timer;
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
  const timer = React.useContext(TimerContext).animationTimer;

  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  // A stable, mutable "instance" that behaves like `this` did in the original
  // class component. Reading everything the animation needs from here keeps the
  // running loop free of stale closures.
  const instanceRef = React.useRef<AnimationInstance | null>(null);
  if (instanceRef.current === null) {
    const initialData = Array.isArray(data) ? data[0] : data;
    instanceRef.current = {
      queue: Array.isArray(data) ? data.slice(1) : [],
      interpolator: null,
      loopID: undefined,
      timeoutID: undefined,
      currentData: initialData,
      generation: 0,
      lastData: data,
      duration,
      ease: d3Ease[formatAnimationName(easing)],
      delay,
      onEnd,
      timer,
    };
  }
  const instance = instanceRef.current;

  // Refresh the latest settings every render so an active animation adopts them.
  instance.duration = duration;
  instance.ease = d3Ease[formatAnimationName(easing)];
  instance.delay = delay;
  instance.onEnd = onEnd;
  instance.timer = timer;

  // Cancel whatever start is currently pending: an active frame loop and/or a
  // delayed start waiting on its timeout.
  const cancelActive = () => {
    if (instance.timeoutID !== undefined) {
      clearTimeout(instance.timeoutID);
      instance.timeoutID = undefined;
    }
    if (instance.loopID !== undefined) {
      instance.timer.unsubscribe(instance.loopID);
      instance.loopID = undefined;
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, generation: number) => {
    // A superseded run must neither render nor complete.
    if (generation !== instance.generation || !instance.interpolator) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = instance.duration ? elapsed / instance.duration : 1;

    if (step >= 1) {
      const finalData = instance.interpolator(1);
      instance.currentData = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (instance.loopID !== undefined) {
        instance.timer.unsubscribe(instance.loopID);
        instance.loopID = undefined;
      }
      instance.queue.shift();
      traverseQueue(generation);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const stepData = instance.interpolator(instance.ease(step));
    instance.currentData = stepData;
    setState({
      data: stepData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (generation: number) => {
    // A superseded run must never continue.
    if (generation !== instance.generation) {
      return;
    }

    if (instance.queue.length) {
      const nextData = instance.queue[0];

      // Interpolate from the currently visible style toward the next target so
      // that a mid-run change continues smoothly instead of flashing.
      instance.interpolator = victoryInterpolator(
        instance.currentData,
        nextData,
      );

      if (instance.delay) {
        instance.timeoutID = setTimeout(() => {
          instance.timeoutID = undefined;
          // The run may have been superseded while waiting on the delay.
          if (generation !== instance.generation) {
            return;
          }
          instance.loopID = instance.timer.subscribe(
            (elapsed) => functionToBeRunEachFrame(elapsed, generation),
            instance.duration,
          );
        }, instance.delay);
      } else {
        instance.loopID = instance.timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, generation),
          instance.duration,
        );
      }
    } else if (instance.onEnd) {
      instance.onEnd();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (instance.queue.length) {
      traverseQueue(instance.generation);
    }

    // Clean up the animation loop
    return () => {
      // Invalidate the run so no queued frame or delayed start can fire later.
      instance.generation += 1;
      if (instance.timeoutID !== undefined) {
        clearTimeout(instance.timeoutID);
        instance.timeoutID = undefined;
      }
      if (instance.loopID !== undefined) {
        instance.timer.unsubscribe(instance.loopID);
        instance.loopID = undefined;
      } else {
        instance.timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Only hand off when `data` genuinely changes (the initial run is started
    // by the mount effect above).
    if (isEqual(data, instance.lastData)) {
      return;
    }
    instance.lastData = data;

    // Hand off to a replacement run: bump the generation so the previous run
    // can neither render nor complete, cancel its pending frames, and animate
    // from the currently visible style toward the new data.
    instance.generation += 1;
    cancelActive();
    instance.queue = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(instance.generation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
