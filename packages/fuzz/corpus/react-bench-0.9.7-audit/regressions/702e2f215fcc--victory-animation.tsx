// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 702e2f215fccf15d4ef070aab50375bc67a585923e5893f5b42376217b0e1df2
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const runIdRef = React.useRef(0);
  const visibleDataRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const delayTimeoutRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easingRef = React.useRef(easing);
  easingRef.current = easing;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const cancelActiveAnimation = () => {
    runIdRef.current += 1;
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeoutRef.current !== undefined) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
  };

  const traverseQueue = (startStyle: AnimationStyle) => {
    const runId = runIdRef.current;

    if (!queue.current.length) {
      if (runId === runIdRef.current && onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(startStyle, nextData);

    const startLoop = () => {
      delayTimeoutRef.current = undefined;
      if (runId !== runIdRef.current) {
        return;
      }
      loopID.current = timer.subscribe(
        (elapsed) => onFrame(elapsed, runId),
        durationRef.current,
      );
    };

    const delayMs = delayRef.current;
    if (delayMs) {
      delayTimeoutRef.current = setTimeout(startLoop, delayMs);
    } else {
      startLoop();
    }
  };

  const onFrame = (elapsed: number, runId: number) => {
    if (runId !== runIdRef.current || !interpolator.current) {
      return;
    }

    const currentDuration = durationRef.current;
    const ease = d3Ease[formatAnimationName(easingRef.current)];
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      visibleDataRef.current = finalData;

      if (runId !== runIdRef.current) {
        return;
      }

      setState({
        data: finalData,
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
      if (runId !== runIdRef.current) {
        return;
      }
      queue.current.shift();
      traverseQueue(finalData);
      return;
    }

    const interpolated = interpolator.current(ease(step));
    visibleDataRef.current = interpolated;

    if (runId !== runIdRef.current) {
      return;
    }

    setState({
      data: interpolated,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    return () => {
      cancelActiveAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    cancelActiveAnimation();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(visibleDataRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
