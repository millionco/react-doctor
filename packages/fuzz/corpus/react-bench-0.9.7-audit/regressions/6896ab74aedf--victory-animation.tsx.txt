// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6896ab74aedfdf3476fcef18209596869dc941227a26468270364c29eafa8392
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
  const latestProps = React.useRef({ duration, easing, onEnd, data, delay });
  React.useEffect(() => {
    latestProps.current = { duration, easing, onEnd, data, delay };
  });

  const [state, setState] = React.useState<VictoryAnimationState>(() => {
    const initialData = Array.isArray(data) ? data[0] : data;
    return {
      data: initialData,
      animationInfo: {
        progress: 0,
        animating: false,
      },
    };
  });

  const currentVisibleStyle = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  const updateState = (
    nextData: AnimationStyle,
    progress: number,
    animating: boolean,
    terminating?: boolean,
  ) => {
    currentVisibleStyle.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress,
        animating,
        ...(terminating !== undefined ? { terminating } : {}),
      },
    });
  };

  const timer = React.useContext(TimerContext).animationTimer;
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<any | undefined>(undefined);
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const isMounted = React.useRef(false);

  const unsubscribeTimer = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
  };

  const subscribeTimer = (runDuration: number) => {
    unsubscribeTimer();
    loopID.current = timer.subscribe(functionToBeRunEachFrame, runDuration);
  };

  const traverseQueue = () => {
    if (queue.current.length > 0) {
      const startStyle = currentVisibleStyle.current;
      const targetStyle = queue.current[0];

      interpolator.current = victoryInterpolator(startStyle, targetStyle);

      const runDuration = latestProps.current.duration ?? DEFAULT_DURATION;
      const runDelay = latestProps.current.delay ?? 0;

      if (runDelay) {
        updateState(startStyle, 0, true);
        delayTimeoutID.current = setTimeout(() => {
          subscribeTimer(runDuration);
        }, runDelay);
      } else {
        updateState(startStyle, 0, true);
        subscribeTimer(runDuration);
      }
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currentDuration = latestProps.current.duration ?? DEFAULT_DURATION;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      queue.current.shift();

      if (queue.current.length > 0) {
        unsubscribeTimer();
        updateState(finalStyle, 1, true, true);
        traverseQueue();
      } else {
        unsubscribeTimer();
        updateState(finalStyle, 1, false, true);
        if (latestProps.current.onEnd) {
          latestProps.current.onEnd();
        }
      }
      return;
    }

    const currentEasing = latestProps.current.easing ?? "quadInOut";
    const ease = d3Ease[formatAnimationName(currentEasing)];
    const easeVal = ease ? ease(step) : step;

    const currentStyle = interpolator.current(easeVal);
    updateState(currentStyle, step, true);
  };

  React.useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      if (Array.isArray(data)) {
        queue.current = data.slice(1);
        traverseQueue();
      }
    } else {
      unsubscribeTimer();
      queue.current = Array.isArray(data) ? data.slice() : [data];
      traverseQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    return () => {
      unsubscribeTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
