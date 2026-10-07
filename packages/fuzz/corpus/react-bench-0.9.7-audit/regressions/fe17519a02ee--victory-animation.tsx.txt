// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit fe17519a02eec3af5861da5b711a49694c185aaa7f1b5dd4756194d018594648
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const ease = d3Ease[formatAnimationName(easing)];

  // Timer and delay callbacks outlive the render that scheduled them, so they
  // read the latest props and the most recently applied style from this ref
  // instead of from the closures they were created in.
  const instance = React.useRef({
    duration,
    ease,
    delay,
    onEnd,
    style: state.data,
  });
  instance.current.duration = duration;
  instance.current.ease = ease;
  instance.current.delay = delay;
  instance.current.onEnd = onEnd;

  // Identifies the active animation run. Bumping it supersedes callbacks
  // scheduled by earlier runs, so they can no longer render, advance the
  // queue, or complete.
  const runID = React.useRef(0);
  const isFirstRender = React.useRef(true);

  const applyState = (nextState: VictoryAnimationState) => {
    instance.current.style = nextState.data;
    setState(nextState);
  };

  // Stop the active run's scheduled callbacks: a pending delayed start and
  // the timer subscription. Safe to call when neither is active.
  const supersedeCurrentRun = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    timer.unsubscribe(loopID.current);
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      runID.current += 1;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The mount render is handled above; this effect only reacts to `data`
    // changing afterwards.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Supersede the active run, if any, so it can neither render nor
    // complete later.
    supersedeCurrentRun();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const run = runID.current;
      const nextData = queue.current[0];

      // Interpolate from the most recently applied style so a replacement
      // run continues from what is currently visible instead of flashing
      // the superseded target.
      interpolator.current = victoryInterpolator(
        instance.current.style,
        nextData,
      );

      const begin = () => {
        if (run !== runID.current) {
          return;
        }
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed, subscribedDuration) =>
            functionToBeRunEachFrame(run, elapsed, subscribedDuration),
          instance.current.duration,
        );
      };

      // Reset step to zero
      if (instance.current.delay) {
        delayID.current = setTimeout(begin, instance.current.delay);
      } else {
        begin();
      }
    } else if (instance.current.onEnd) {
      instance.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    run: number,
    elapsed: number,
    subscribedDuration: number,
  ) => {
    // Frames from superseded runs must not render or complete.
    if (run !== runID.current || !interpolator.current) {
      return;
    }

    // A zero `subscribedDuration` means the timer bypassed animation when
    // this run started; otherwise use the latest `duration` prop so
    // in-flight animations adopt prop changes.
    const activeDuration =
      subscribedDuration === 0 ? 0 : instance.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      applyState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    applyState({
      data: interpolator.current(instance.current.ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
