// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6353dfb5edfbf8cd4be0271937bf8b37c7205692c5a440b7b4ad2d26cbca85cd
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
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayedStart = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(true);
  const visibleData = React.useRef(state.data);
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);

  // These refs let an already subscribed animation use the latest props. A
  // timer callback otherwise keeps the values from the render in which it was
  // subscribed.
  durationRef.current = duration;
  easingRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  const cancelAnimation = () => {
    if (delayedStart.current !== undefined) {
      clearTimeout(delayedStart.current);
      delayedStart.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    interpolator.current = null;
  };

  const setAnimationState = (
    animationData: AnimationStyle,
    animationInfo: AnimationInfo,
    runGeneration: number,
  ) => {
    if (!mounted.current || generation.current !== runGeneration) return;
    visibleData.current = animationData;
    setState({ data: animationData, animationInfo });
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    runGeneration: number,
    runInterpolator: (value: number) => AnimationStyle,
  ) => {
    // A callback can already be in Timer's iteration when it is unsubscribed.
    // Ignore it if a newer run has taken ownership of the animation.
    if (!mounted.current || generation.current !== runGeneration) return;

    // Step can generate imprecise values, sometimes greater than 1.
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setAnimationState(
        runInterpolator(1),
        {
          progress: 1,
          animating: false,
          terminating: true,
        },
        runGeneration,
      );
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      traverseQueue(runGeneration);
      return;
    }

    setAnimationState(
      runInterpolator(easingRef.current(step)),
      {
        progress: step,
        animating: step < 1,
      },
      runGeneration,
    );
  };

  const traverseQueue = (runGeneration: number) => {
    if (!mounted.current || generation.current !== runGeneration) return;

    if (queue.current.length) {
      const nextData = queue.current.shift();
      if (!nextData) return;

      // Always start from what was actually rendered. This is important when
      // a new data prop replaces an animation in the middle of a queued run.
      const runInterpolator = victoryInterpolator(
        visibleData.current,
        nextData,
      );
      interpolator.current = runInterpolator;

      const start = () => {
        delayedStart.current = undefined;
        if (!mounted.current || generation.current !== runGeneration) return;
        loopID.current = timer.subscribe(
          (elapsed) =>
            functionToBeRunEachFrame(elapsed, runGeneration, runInterpolator),
          durationRef.current,
        );
      };

      if (delay) {
        delayedStart.current = setTimeout(start, delay);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const replaceAnimation = (nextData: AnimationData) => {
    generation.current += 1;
    const runGeneration = generation.current;
    cancelAnimation();
    // A timer may have queued a state update without React having committed
    // it yet. Use the committed render as the handoff point in that case.
    visibleData.current = state.data;
    queue.current = Array.isArray(nextData) ? nextData.slice() : [nextData];
    traverseQueue(runGeneration);
  };

  React.useEffect(() => {
    // The initial array item is rendered immediately; only its remaining
    // items belong to the initial queue.
    if (queue.current.length) {
      traverseQueue(generation.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const didMount = React.useRef(false);
  React.useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }

    replaceAnimation(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    return () => {
      mounted.current = false;
      generation.current += 1;
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children(state.data, state.animationInfo);
};
