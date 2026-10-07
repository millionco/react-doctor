// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit e75e922444e00f9f337648665b223b1e84299be5f1e873d90d1c9fc8f2696a2c
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
    Array.isArray(data) ? data.slice(1) : [],
  );
  const visibleData = React.useRef(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);

  // Animation callbacks intentionally read these refs. Recreating a run is only
  // necessary when its data changes; the other animation props should take
  // effect on the very next frame (or when the current queue completes).
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  onEndRef.current = onEnd;

  const cancelRun = () => {
    runID.current += 1;

    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }

    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (currentRunID: number) => {
    if (!mounted.current || currentRunID !== runID.current) return;

    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }

    const nextData = queue.current[0];
    interpolator.current = victoryInterpolator(visibleData.current, nextData);

    const start = () => {
      delayID.current = undefined;
      if (!mounted.current || currentRunID !== runID.current) return;

      loopID.current = timer.subscribe((elapsed: number) => {
        if (
          !mounted.current ||
          currentRunID !== runID.current ||
          !interpolator.current
        ) {
          return;
        }

        const currentDuration = durationRef.current;
        const step = currentDuration ? elapsed / currentDuration : 1;

        if (step >= 1) {
          const finalData = interpolator.current(1);
          visibleData.current = finalData;
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
          queue.current.shift();
          traverseQueue(currentRunID);
          return;
        }

        const ease = d3Ease[formatAnimationName(easingRef.current)];
        const frameData = interpolator.current(ease(step));
        visibleData.current = frameData;
        setState({
          data: frameData,
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
      }, durationRef.current);
    };

    if (delay) {
      delayID.current = setTimeout(start, delay);
    } else {
      start();
    }
  };

  React.useEffect(() => {
    mounted.current = true;

    // An object (or a one-item array) supplies the initial visible style and
    // does not constitute an animation by itself.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    return () => {
      mounted.current = false;
      cancelRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // This also keeps React strict effects from mistaking their second setup
    // pass for a data update.
    if (previousData.current === data) return;
    previousData.current = data;

    // Hand a replacement run the last style that was actually rendered. Its
    // generation prevents delayed or already-queued callbacks from reviving a
    // superseded run.
    cancelRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
