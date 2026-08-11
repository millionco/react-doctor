// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0e014e28d3a8b7cbe2df88f7161d00fca40fd5223030eb2766483d5c5de12d56
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
  const stateRef = React.useRef(state);
  const renderedData = React.useRef(state.data);
  renderedData.current = state.data;
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(true);
  const initialized = React.useRef(false);
  const previousData = React.useRef(data);
  const latestData = React.useRef(data);
  latestData.current = data;

  // Timer callbacks can outlive the render that subscribed them. Keep all
  // settings that are allowed to change during a run in refs so each frame and
  // the eventual completion use the latest props.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const startNext = React.useRef<() => void>(() => undefined);
  const runFrame = React.useRef<(elapsed: number, run: number) => void>(
    () => undefined,
  );

  const renderState = (nextState: VictoryAnimationState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const cancelActiveRun = () => {
    generation.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  startNext.current = () => {
    if (!mounted.current) return;

    if (!queue.current.length) {
      interpolator.current = null;
      onEndRef.current?.();
      return;
    }

    interpolator.current = victoryInterpolator(
      stateRef.current.data,
      queue.current[0],
    );
    const run = generation.current;
    const subscribe = () => {
      delayID.current = undefined;
      if (!mounted.current || generation.current !== run) return;

      loopID.current = timer.subscribe(
        (elapsed) => runFrame.current(elapsed, run),
        durationRef.current,
      );
    };

    if (delayRef.current) {
      delayID.current = setTimeout(subscribe, delayRef.current);
    } else {
      subscribe();
    }
  };

  runFrame.current = (elapsed, run) => {
    if (
      !mounted.current ||
      generation.current !== run ||
      previousData.current !== latestData.current ||
      !interpolator.current
    ) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1.
    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      renderState({
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
      // A completed queue step must not be able to drive the next one if its
      // callback was already in flight when it was unsubscribed.
      generation.current += 1;
      queue.current.shift();
      startNext.current();
      return;
    }

    renderState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelActiveRun();
    };
    // The timer is supplied by context and is expected to remain stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The first item of array data is the initially rendered style; the rest
    // form its ordered animation queue. A single object does not animate until
    // it is replaced.
    if (!initialized.current) {
      initialized.current = true;
      previousData.current = data;
      if (queue.current.length) {
        startNext.current();
      }
      return;
    }

    // React may replay effects in development. Only an actual data identity
    // change should replace the active run.
    if (previousData.current === data) {
      // The unmount cleanup is also replayed in Strict Mode. Resume an initial
      // queue that the simulated cleanup canceled.
      if (
        queue.current.length &&
        loopID.current === undefined &&
        delayID.current === undefined
      ) {
        startNext.current();
      }
      return;
    }
    previousData.current = data;

    // Invalidate the old callback before constructing the replacement tween.
    // Its starting point is the last style actually handed to children, never
    // the superseded target.
    cancelActiveRun();
    queue.current = Array.isArray(data) ? data : [data];
    const visibleData = renderedData.current;
    renderState({
      data: visibleData,
      animationInfo: {
        progress: 0,
        animating: false,
      },
    });
    startNext.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
