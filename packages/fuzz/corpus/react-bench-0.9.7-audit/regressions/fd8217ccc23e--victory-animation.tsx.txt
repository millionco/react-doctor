// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit fd8217ccc23eed82f2ca01b5db549e502a7345929de84f0eeb34ea4dce13c0ba
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
  const [state, setState] = React.useState<VictoryAnimationState>(() => ({
    data: Array.isArray(data) ? data[0] : data,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  }));

  const timer = React.useContext(TimerContext).animationTimer;

  const latestDuration = React.useRef(duration);
  const latestEasing = React.useRef(easing);
  const latestOnEnd = React.useRef(onEnd);
  const latestDelay = React.useRef(delay);

  latestDuration.current = duration;
  latestEasing.current = easing;
  latestOnEnd.current = onEnd;
  latestDelay.current = delay;

  const currentStyle = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const isMounted = React.useRef(false);

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = latestDuration.current ? elapsed / latestDuration.current : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      currentStyle.current = finalStyle;
      setState({
        data: finalStyle,
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
      traverseQueue();
      return;
    }

    const easeName = formatAnimationName(latestEasing.current || "quadInOut");
    const ease = d3Ease[easeName] || d3Ease.easeQuadInOut;
    const nextStyle = interpolator.current(ease(step));
    currentStyle.current = nextStyle;

    setState({
      data: nextStyle,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      if (latestDelay.current) {
        delayTimeoutID.current = setTimeout(() => {
          delayTimeoutID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            latestDuration.current,
          );
        }, latestDelay.current);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          latestDuration.current,
        );
      }
    } else if (latestOnEnd.current) {
      latestOnEnd.current();
    }
  };

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      if (Array.isArray(data) && data.length > 1) {
        traverseQueue();
      }
    } else {
      // Clean up previous runs
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (delayTimeoutID.current) {
        clearTimeout(delayTimeoutID.current);
        delayTimeoutID.current = undefined;
      }

      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }

    return () => {
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (delayTimeoutID.current) {
        clearTimeout(delayTimeoutID.current);
        delayTimeoutID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
