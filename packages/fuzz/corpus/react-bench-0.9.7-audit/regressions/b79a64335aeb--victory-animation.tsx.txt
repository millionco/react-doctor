// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b79a64335aeb0336b8df69799f8c23e7af3cb11c0ecb1be0a303c0c0f4452cf5
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

// Animation runs must be superseded in the same commit that changed the
// props, before another timer frame can fire. `useLayoutEffect` warns when
// rendering on the server, where no animation ever starts anyway.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

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
  const ease = d3Ease[formatAnimationName(easing)];

  // The timer holds on to the frame function across renders, so it reads the
  // animation settings through this ref to make an in-progress animation pick
  // up the latest values instead of the ones captured when it was subscribed.
  const settings = React.useRef({ duration, ease, delay, onEnd });

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  // The style most recently handed to `children`; replacement animations
  // interpolate from here so a superseded target is never rendered.
  const visibleStyle = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Identifies the current run. Bumping it strands callbacks that belong to a
  // superseded run, so they can neither render nor complete.
  const runID = React.useRef(0);
  const previousData = React.useRef(data);

  useIsomorphicLayoutEffect(() => {
    settings.current = { duration, ease, delay, onEnd };
  });

  const cancelActiveAnimation = () => {
    runID.current += 1;
    if (delayTimeoutID.current !== null) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = null;
    }
    timer.unsubscribe(loopID.current);
  };

  const traverseQueue = () => {
    const activeRunID = runID.current;
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from whatever style is currently on screen
      interpolator.current = victoryInterpolator(
        visibleStyle.current,
        nextData,
      );

      const subscribeToTimer = () => {
        loopID.current = timer.subscribe(
          (elapsed, subscribedDuration) =>
            functionToBeRunEachFrame(elapsed, subscribedDuration, activeRunID),
          settings.current.duration,
        );
      };

      // Reset step to zero
      if (settings.current.delay) {
        delayTimeoutID.current = setTimeout(() => {
          delayTimeoutID.current = null;
          if (activeRunID === runID.current) {
            subscribeToTimer();
          }
        }, settings.current.delay);
      } else {
        subscribeToTimer();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    subscribedDuration: number,
    activeRunID: number,
  ) => {
    // A superseded run must neither render nor complete
    if (activeRunID !== runID.current || !interpolator.current) return;

    // The timer reports a duration of 0 when animation is bypassed; otherwise
    // honor the current `duration` prop, even if it changed after this run
    // was subscribed.
    const activeDuration =
      subscribedDuration === 0 ? 0 : settings.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      visibleStyle.current = interpolator.current(1);
      setState({
        data: visibleStyle.current,
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
    visibleStyle.current = interpolator.current(settings.current.ease(step));
    setState({
      data: visibleStyle.current,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  useIsomorphicLayoutEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop and any pending delayed start
    return () => {
      cancelActiveAnimation();
      if (!loopID.current) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIsomorphicLayoutEffect(() => {
    // This effect also runs on the first render, where the mount effect above
    // has already started the initial animation.
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Supersede the in-progress run (if any) and start a replacement run from
    // the currently visible style, so the old target never flashes and only
    // the replacement can complete.
    cancelActiveAnimation();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
