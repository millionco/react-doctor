// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit a58d8dbc45ad29f1182e8743f7012732bf16e286b2281b210a66a1b57f14efcd
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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
  const [state, setState] = React.useState<VictoryAnimationState>(() => {
    const initialStyle = Array.isArray(data) ? data[0] : data;
    return {
      data: initialStyle,
      animationInfo: {
        progress: 0,
        animating: false,
      },
    };
  });

  const timer = React.useContext(TimerContext).animationTimer;

  // Refs to always hold the latest props
  const durationRef = React.useRef(duration);
  durationRef.current = duration;

  const easingRef = React.useRef(easing);
  easingRef.current = easing;

  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  // Active state / style / loop / delay trackers
  const currentStyleRef = React.useRef<AnimationStyle>(state.data);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<any>(null);

  const isMountedRef = React.useRef(false);
  const prevDataRef = React.useRef(data);

  const updateState = (nextState: VictoryAnimationState) => {
    currentStyleRef.current = nextState.data;
    setState(nextState);
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare currently visible version to next target
      interpolator.current = victoryInterpolator(
        currentStyleRef.current,
        nextData,
      );

      const runAnimation = () => {
        updateState({
          data: currentStyleRef.current,
          animationInfo: {
            progress: 0,
            animating: true,
          },
        });
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      if (delay) {
        delayTimeoutID.current = setTimeout(() => {
          delayTimeoutID.current = null;
          runAnimation();
        }, delay);
      } else {
        runAnimation();
      }
    } else {
      if (onEndRef.current) {
        onEndRef.current();
      }
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currentDuration = durationRef.current;
    const currentEasing = easingRef.current;
    const ease = d3Ease[formatAnimationName(currentEasing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      updateState({
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

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    updateState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Start active queue on initial mount if there is any target to animate to
    if (queue.current.length) {
      traverseQueue();
    }

    return () => {
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      if (delayTimeoutID.current) {
        clearTimeout(delayTimeoutID.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }

    if (isEqual(prevDataRef.current, data)) {
      return;
    }
    prevDataRef.current = data;

    // Cancel existing loop and delay timeouts
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];

    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
