// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 83b30f5f34e4a7fb229f93bc31d246cc7b85448a8db4d54a719f27e48396a698
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

interface LatestAnimationSettings {
  duration: number;
  ease: (t: number) => number;
  delay: number;
  onEnd?: () => void;
}

export const VictoryAnimation = ({
  duration = DEFAULT_DURATION,
  easing = "quadInOut",
  delay = 0,
  data,
  children,
  onEnd,
}: VictoryAnimationProps) => {
  const initialStyle = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialStyle,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;

  // The style that's currently being rendered. Unlike `state.data`, this is
  // updated synchronously whenever we compute a new value, so the frame loop
  // below can always read the true current style, even though it may keep
  // running across renders without picking up a new closure.
  const currentStyle = React.useRef<AnimationStyle>(initialStyle);
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

  // `duration`/`easing`/`onEnd` as of the most recent render, read fresh by
  // the frame loop every frame. The loop is only (re)subscribed when a tween
  // starts, so without this, a change to any of these would be invisible to
  // an already-running animation until it happened to finish.
  const ease = d3Ease[formatAnimationName(easing)];
  const settings = React.useRef<LatestAnimationSettings>({
    duration,
    ease,
    delay,
    onEnd,
  });
  React.useEffect(() => {
    settings.current = { duration, ease, delay, onEnd };
  });

  const cancelActiveRun = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    timer.unsubscribe(loopID.current);
    loopID.current = undefined;
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to next props
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      const { delay: currentDelay, duration: currentDuration } =
        settings.current;

      // Reset step to zero
      if (currentDelay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            currentDuration,
          );
        }, currentDelay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          currentDuration,
        );
      }
    } else {
      settings.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration: currentDuration, ease: currentEase } = settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      currentStyle.current = finalStyle;
      interpolator.current = null;
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;

      setState({
        data: finalStyle,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const stepStyle = interpolator.current(currentEase(step));
    currentStyle.current = stepStyle;
    setState({
      data: stepStyle,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks the `data` this effect last actually handled, rather than a
  // one-shot "is this the first run" flag: React (Strict Mode in
  // particular) can replay an effect's mount without resetting refs, and
  // comparing against the last-seen `data` keeps that replay a no-op
  // instead of spuriously superseding the run this same effect just started.
  const previousDataRef = React.useRef(data);
  React.useEffect(() => {
    if (data === previousDataRef.current) {
      return;
    }
    previousDataRef.current = data;
    // New data supersedes whatever run is currently active (including one
    // that's itself a replacement, or one still waiting out a queued step's
    // delay). Cancel it so it can never render or complete again, and pick
    // up from the style that's currently visible rather than jumping to the
    // superseded run's target.
    cancelActiveRun();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
