// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0fcfbebedcf92ee641f3a5eb761d8bcdb00dedd7205ac1727a53b999d8584e93
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
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isInitialMount = React.useRef(true);

  // The currently visible style, kept in sync (synchronously, unlike state)
  // so a run that hands off to a new target always starts from exactly what's
  // on screen instead of a possibly-stale render snapshot.
  const visibleData = React.useRef<AnimationStyle>(initialData);

  // An in-progress run must keep using the latest duration/easing/onEnd
  // rather than whatever was in effect when it started, so these live in
  // refs that get updated every render instead of being closed over.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  easeRef.current = d3Ease[formatAnimationName(easing)];
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const setAnimationState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const cancelActiveRun = () => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (queue.current.length) {
        traverseQueue();
      }
    } else {
      // Cancel whatever run is currently active (including a pending
      // delayed start) and continue from the currently visible style toward
      // the new data, so a superseded run never renders or completes.
      cancelActiveRun();
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue();
    }

    // Stop the active timer on unmount (or before handling the next data
    // change) so a completion can't fire afterward.
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to the next target
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      // Reset step to zero
      if (delay) {
        timeoutID.current = setTimeout(() => {
          timeoutID.current = undefined;
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            durationRef.current,
          );
        }, delay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      setAnimationState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setAnimationState(interpolator.current(easeRef.current(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  return children(state.data, state.animationInfo);
};
