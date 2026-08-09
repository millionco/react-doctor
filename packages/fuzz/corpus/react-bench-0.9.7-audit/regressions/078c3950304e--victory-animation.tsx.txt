// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 078c3950304ec0668790c14d60097e3188836b40b83722308c95b34f1b525739
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
  const initialData = Array.isArray(data) ? data[0] : data;
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
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const activeTimer = React.useRef(timer);
  const runID = React.useRef(0);
  const stepID = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef(data);
  const visibleData = React.useRef(initialData);
  const renderedState = React.useRef(state);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);

  // Keep values used by timer callbacks current without restarting a run.
  durationRef.current = duration;
  delayRef.current = delay;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  // A parent update can render before a pending state update from a timer is
  // committed. Retain the style most recently calculated by the timer as the
  // starting point for a replacement run.
  if (renderedState.current !== state) {
    renderedState.current = state;
    visibleData.current = state.data;
  }

  const cancelAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      activeTimer.current.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    interpolator.current = null;
  };

  const startQueue = (currentRun: number) => {
    if (!mounted.current || currentRun !== runID.current) return;

    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }

    const nextData = queue.current[0];
    const currentStep = ++stepID.current;
    const currentInterpolator = victoryInterpolator(
      visibleData.current,
      nextData,
    );
    interpolator.current = currentInterpolator;

    const subscribe = () => {
      delayID.current = undefined;
      if (!mounted.current || currentRun !== runID.current) return;

      activeTimer.current = timer;
      loopID.current = timer.subscribe((elapsed: number) => {
        if (
          !mounted.current ||
          currentRun !== runID.current ||
          currentStep !== stepID.current
        ) {
          return;
        }

        // Step can generate imprecise values, sometimes greater than 1. If
        // this happens set the state to 1 and cancel the timer.
        const step = durationRef.current ? elapsed / durationRef.current : 1;

        if (step >= 1) {
          const finalData = currentInterpolator(1);
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
            activeTimer.current.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          interpolator.current = null;
          queue.current.shift();
          startQueue(currentRun);
          return;
        }

        const nextStyle = currentInterpolator(easeRef.current(step));
        visibleData.current = nextStyle;
        setState({
          data: nextStyle,
          animationInfo: {
            progress: step,
            animating: step < 1,
          },
        });
      }, durationRef.current);
    };

    if (delayRef.current) {
      delayID.current = setTimeout(subscribe, delayRef.current);
    } else {
      subscribe();
    }
  };

  const replaceRun = () => {
    runID.current += 1;
    cancelAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];

    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }

    // Keep the currently visible style while the replacement run is being
    // scheduled; never render the superseded target as an intermediate state.
    setState({
      data: visibleData.current,
      animationInfo: {
        progress: 0,
        animating: true,
      },
    });
    startQueue(runID.current);
  };

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      startQueue(runID.current);
    }

    return () => {
      mounted.current = false;
      runID.current += 1;
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current !== data) {
      previousData.current = data;
      replaceRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
