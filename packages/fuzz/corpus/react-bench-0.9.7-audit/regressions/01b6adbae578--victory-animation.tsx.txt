// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 01b6adbae578148698d32405a0d3358607cc73a251c390d5aa687c4f3409c037
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import { now } from "victory-vendor/d3-timer";

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

const isDataEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDataEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!isDataEqual(a[key], b[key])) return false;
  }

  return true;
};

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

  // Keep track of the currently visible/rendered style in a mutable ref
  const currentStyleRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );

  // Keep mutable refs of changing props so the active animation can adopt them mid-run
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);

  React.useEffect(() => {
    durationRef.current = duration;
    easingRef.current = easing;
    onEndRef.current = onEnd;
    delayRef.current = delay;
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutId = React.useRef<any>(null);
  const stepStartTimeRef = React.useRef<number>(0);

  const isMountedRef = React.useRef(false);
  const isFirstRender = React.useRef(true);
  const prevDataRef = React.useRef<AnimationData>(data);

  const cleanupActiveRun = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutId.current !== null) {
      clearTimeout(delayTimeoutId.current);
      delayTimeoutId.current = null;
    }
  };

  const functionToBeRunEachFrame = () => {
    if (!interpolator.current) return;

    const currentDuration = durationRef.current;
    const elapsed = now() - stepStartTimeRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      currentStyleRef.current = finalStyle;

      setState({
        data: finalStyle,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });

      cleanupActiveRun();
      queue.current.shift();
      traverseQueue();
      return;
    }

    const ease = d3Ease[formatAnimationName(easingRef.current)];
    const currentStyle = interpolator.current(ease(step));
    currentStyleRef.current = currentStyle;

    setState({
      data: currentStyle,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      interpolator.current = victoryInterpolator(
        currentStyleRef.current,
        nextData,
      );

      const runStep = () => {
        stepStartTimeRef.current = now();
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      const currentDelay = delayRef.current;
      if (currentDelay) {
        delayTimeoutId.current = setTimeout(() => {
          delayTimeoutId.current = null;
          runStep();
        }, currentDelay);
      } else {
        runStep();
      }
    } else {
      if (onEndRef.current) {
        onEndRef.current();
      }
    }
  };

  React.useEffect(() => {
    isMountedRef.current = true;

    // Preserve delayed starts and ordered array-data queues on mount
    queue.current = Array.isArray(data) ? data.slice(1) : [];
    if (queue.current.length > 0) {
      traverseQueue();
    }

    return () => {
      isMountedRef.current = false;
      cleanupActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (isDataEqual(prevDataRef.current, data)) {
      return;
    }
    prevDataRef.current = data;

    // Cancel existing loop and delay if they exist
    cleanupActiveRun();

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];

    // Start traversing the tween queue from currentStyleRef
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
