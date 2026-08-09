// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 73bf4292c49a5539a6b3ba0b714591707d5cd062dc52eb479811e5192738d44a
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

  // In-flight animations read these refs each frame so they always use the
  // latest props, even when the props change mid-run.
  const latest = React.useRef({ duration, ease, delay, onEnd });
  latest.current = { duration, ease, delay, onEnd };

  // The style currently handed to `children`. New animations interpolate from
  // here so a data change mid-run continues from what is visible on screen.
  const visibleStyle = React.useRef<AnimationStyle>(state.data);

  // Incremented whenever a run is superseded; frames and delayed starts
  // belonging to an older token are ignored.
  const runToken = React.useRef(0);

  const stopTimer = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const applyState = (newState: VictoryAnimationState) => {
    visibleStyle.current = newState.data;
    setState(newState);
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        visibleStyle.current,
        nextData,
      );

      const token = runToken.current;
      const start = () => {
        delayID.current = undefined;
        if (token !== runToken.current) return;
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame(token),
          latest.current.duration,
        );
      };

      // Reset step to zero
      if (latest.current.delay) {
        delayID.current = setTimeout(start, latest.current.delay);
      } else {
        start();
      }
    } else if (latest.current.onEnd) {
      latest.current.onEnd();
    }
  };

  const functionToBeRunEachFrame =
    (token: number) => (elapsed: number, subscribedDuration: number) => {
      // Ignore frames from a superseded run so it can neither render nor
      // complete after being replaced.
      if (token !== runToken.current || !interpolator.current) return;

      // A subscribed duration of 0 means animation is bypassed; otherwise use
      // the latest `duration` prop so mid-run changes take effect.
      const activeDuration =
        subscribedDuration === 0 ? 0 : latest.current.duration;

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
        stopTimer();
        queue.current.shift();
        traverseQueue();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      applyState({
        data: interpolator.current(latest.current.ease(step)),
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      runToken.current += 1;
      stopTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousData = React.useRef(data);
  React.useEffect(() => {
    // The mount effect above already started the initial queue.
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // New data supersedes any in-progress run: cancel it without rendering or
    // completing it, then animate from the currently visible style.
    runToken.current += 1;
    stopTimer();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
