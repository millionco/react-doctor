// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 39ce29444ca3f105df7a81bc0b99a63fd8d58c69fc8dbcb13c557da7017f2505
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
  const initialData = React.useMemo(() => {
    return Array.isArray(data) ? { ...data[0] } : { ...data };
  }, [data]);

  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<any>(null);

  const currentStyle = React.useRef<AnimationStyle>(initialData);

  const latestDuration = React.useRef(duration);
  const latestEasing = React.useRef(easing);
  const latestOnEnd = React.useRef(onEnd);

  const isFirstRender = React.useRef(true);
  const previousData = React.useRef(data);

  React.useEffect(() => {
    latestDuration.current = duration;
    latestEasing.current = easing;
    latestOnEnd.current = onEnd;
  });

  const unsubscribeAndClear = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current !== null) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const dur = latestDuration.current;
    const step = dur ? elapsed / dur : 1;

    if (step >= 1) {
      const finalStyle = { ...interpolator.current(1) };
      currentStyle.current = finalStyle;
      setState({
        data: finalStyle,
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
      traverseQueue();
      return;
    }

    const easeFn = d3Ease[formatAnimationName(latestEasing.current)];
    const currentFrameStyle = { ...interpolator.current(easeFn(step)) };
    currentStyle.current = currentFrameStyle;
    setState({
      data: currentFrameStyle,
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
      interpolator.current = victoryInterpolator(currentStyle.current, nextData);

      setState({
        data: currentStyle.current,
        animationInfo: {
          progress: 0,
          animating: true,
        },
      });

      // Reset step to zero
      const del = delay;
      if (del) {
        delayTimeoutID.current = setTimeout(() => {
          loopID.current = timer.subscribe(functionToBeRunEachFrame, latestDuration.current);
        }, del);
      } else {
        loopID.current = timer.subscribe(functionToBeRunEachFrame, latestDuration.current);
      }
    } else if (latestOnEnd.current) {
      latestOnEnd.current();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      unsubscribeAndClear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previousData.current = data;
      return;
    }
    if (isEqual(previousData.current, data)) {
      return;
    }
    previousData.current = data;

    // Cancel existing loop and delay timeout
    unsubscribeAndClear();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
