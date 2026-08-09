// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 73907a899df003786d92ffb23ba965fc7761fd5f1865479c90aaae1037bfde7e
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
  const initialStyle = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialStyle,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;

  // `traverseQueue` and `functionToBeRunEachFrame` are handed to the shared
  // timer and keep running across renders without being recreated. They read
  // `duration`/`easing`/`onEnd` through this ref (kept current below on every
  // render) so an active run always uses the latest values instead of the
  // ones captured when it was subscribed.
  const config = React.useRef({
    duration,
    delay,
    ease: d3Ease[formatAnimationName(easing)],
    onEnd,
  });
  config.current = {
    duration,
    delay,
    ease: d3Ease[formatAnimationName(easing)],
    onEnd,
  };

  // Mirrors the style currently rendered. Unlike `state.data`, this is
  // updated synchronously, so the next tween can always continue from
  // exactly what's visible instead of a react state value that may lag
  // behind by a frame or more.
  const visibleStyle = React.useRef<AnimationStyle>(initialStyle);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isFirstRun = React.useRef(true);

  const setStyle = (style: AnimationStyle, animationInfo: AnimationInfo) => {
    visibleStyle.current = style;
    setState({ data: style, animationInfo });
  };

  // Cancels whatever this instance currently has pending (a delayed start or
  // a running tween) without touching the shared timer's other subscribers.
  const cancelActive = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = () => {
    if (!queue.current.length) {
      config.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];

    // Compare cached version to next props
    interpolator.current = victoryInterpolator(visibleStyle.current, nextData);

    const subscribe = () => {
      delayID.current = undefined;
      loopID.current = timer.subscribe(
        functionToBeRunEachFrame,
        config.current.duration,
      );
    };

    // Reset step to zero
    if (config.current.delay) {
      delayID.current = setTimeout(subscribe, config.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = config.current.duration
      ? elapsed / config.current.duration
      : 1;

    if (step >= 1) {
      setStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      cancelActive();
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setStyle(interpolator.current(config.current.ease(step)), {
      progress: step,
      animating: true,
    });
  };

  React.useEffect(() => {
    if (isFirstRun.current) {
      // The initial queue (everything but the already-visible first value)
      // was seeded by the `useRef` initializer above.
      isFirstRun.current = false;
    } else {
      // A new `data` value supersedes any run already in flight. Replace the
      // queue outright and let `traverseQueue` continue from `visibleStyle`,
      // i.e. whatever is currently on screen, rather than flashing the
      // superseded target.
      queue.current = Array.isArray(data) ? data : [data];
    }

    // Length check prevents us from triggering `onEnd` when there's nothing
    // queued to animate.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up any in-flight delay/animation loop so a superseded run can
    // never render or complete later, including after unmount.
    return cancelActive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
