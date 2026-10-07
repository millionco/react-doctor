// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit bd63e870aeb118e17221cb13711c9970d0839b78c880a92cbaa5bd95723e5119
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

  // Track the currently visible style in a ref to always know the latest visible style.
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
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const activeAnimationId = React.useRef<number>(0);
  const hasMounted = React.useRef<boolean>(false);

  // Adopt the latest duration, easing, and onEnd
  const latestDuration = React.useRef(duration);
  const latestEasing = React.useRef(easing);
  const latestOnEnd = React.useRef(onEnd);

  latestDuration.current = duration;
  latestEasing.current = easing;
  latestOnEnd.current = onEnd;

  const functionToBeRunEachFrame = (elapsed: number, runId: number) => {
    if (runId !== activeAnimationId.current) {
      return;
    }
    if (!interpolator.current) return;

    const dur = latestDuration.current;
    const step = dur ? elapsed / dur : 1;

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
      traverseQueue(runId);
      return;
    }

    const currentEaseName = formatAnimationName(latestEasing.current);
    // eslint-disable-next-line import/namespace
    const easeFn = d3Ease[currentEaseName];
    const easedStep = easeFn ? easeFn(step) : step;

    const interpolatedStyle = interpolator.current(easedStep);
    currentStyle.current = interpolatedStyle;

    setState({
      data: interpolatedStyle,
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  const traverseQueue = (runId: number) => {
    if (runId !== activeAnimationId.current) {
      return;
    }

    if (queue.current.length) {
      const nextData = queue.current[0];

      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      if (delay) {
        timeoutID.current = setTimeout(() => {
          if (runId === activeAnimationId.current) {
            loopID.current = timer.subscribe(
              (elapsed) => functionToBeRunEachFrame(elapsed, runId),
              latestDuration.current,
            );
          }
        }, delay);
      } else {
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runId),
          latestDuration.current,
        );
      }
    } else {
      if (latestOnEnd.current) {
        latestOnEnd.current();
      }
    }
  };

  React.useEffect(() => {
    if (queue.current.length) {
      activeAnimationId.current += 1;
      traverseQueue(activeAnimationId.current);
    }

    return () => {
      if (timeoutID.current) {
        clearTimeout(timeoutID.current);
        timeoutID.current = undefined;
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
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    activeAnimationId.current += 1;
    const runId = activeAnimationId.current;

    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (timeoutID.current) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }

    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
