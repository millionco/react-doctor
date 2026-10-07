// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1c2a7bdb61551530f7953a53e640fb50f8913de48d98cd9cb43ef21693558472
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

  /**
   * The style that is currently rendered. New animations interpolate from this
   * value, so replacing `data` mid-animation continues from what the user can
   * see rather than jumping to the target that was just abandoned.
   */
  const currentStyle = React.useRef<AnimationStyle>(state.data);

  /**
   * Identifies the animation that is allowed to render. Frames and delayed
   * starts still held by the timer compare the id they were created with
   * against this one, so a superseded animation can neither render nor
   * complete.
   */
  const activeID = React.useRef(0);
  const isFirstAnimation = React.useRef(true);

  /**
   * Animation settings are read from a ref at the moment they are used, so an
   * animation that is already running adopts the latest props instead of the
   * ones that were current when it started.
   */
  const settings = React.useRef({ duration, easing, delay, onEnd });
  React.useEffect(() => {
    settings.current = { duration, easing, delay, onEnd };
  });

  const stopAnimation = () => {
    // Anything the timer still holds belongs to a superseded animation now
    activeID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (animationID: number) => {
    if (animationID !== activeID.current) return;

    if (!queue.current.length) {
      settings.current.onEnd?.();
      return;
    }

    const nextData = queue.current[0];

    // Compare the style being rendered to next props
    interpolator.current = victoryInterpolator(currentStyle.current, nextData);

    // Reset step to zero
    const subscribe = () => {
      delayID.current = undefined;
      if (animationID !== activeID.current) return;
      loopID.current = timer.subscribe(
        (elapsed) => functionToBeRunEachFrame(elapsed, animationID),
        settings.current.duration,
      );
    };

    if (settings.current.delay) {
      delayID.current = setTimeout(subscribe, settings.current.delay);
    } else {
      subscribe();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, animationID: number) => {
    if (animationID !== activeID.current || !interpolator.current) return;

    const { duration: activeDuration, easing: activeEasing } = settings.current;
    const ease = d3Ease[formatAnimationName(activeEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

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
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(animationID);
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
    // Clean up the animation loop, so it cannot complete after unmounting
    return () => {
      const wasSubscribed = loopID.current !== undefined;
      stopAnimation();
      if (!wasSubscribed) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isFirstAnimation.current) {
      isFirstAnimation.current = false;
      // The queue is already primed with the initial data. The length check
      // prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue(activeID.current);
      }
      return;
    }

    // Cancel the animation in progress: now that it has been superseded it may
    // neither render nor call `onEnd`
    stopAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue, continuing from the rendered style
    traverseQueue(activeID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
