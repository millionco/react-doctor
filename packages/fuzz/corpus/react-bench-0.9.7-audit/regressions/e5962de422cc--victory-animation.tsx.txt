// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit e5962de422cc5938f36acda9fdd3c0ee34ecfbb5159ca56d5cd2ed1899fd1747
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

  // Active animations must always use the most recent props, so keep them in
  // a ref that every timer callback reads from instead of its own closure.
  const latest = React.useRef({ duration, ease, delay, onEnd });
  latest.current = { duration, ease, delay, onEnd };

  // The style currently on screen; a new run interpolates from here so a
  // data change hands off without flashing the superseded target.
  const visibleData = React.useRef<AnimationStyle>(state.data);

  // Incremented whenever the current run is superseded (new data or
  // unmount). Callbacks holding an older token must not render or complete.
  const runToken = React.useRef(0);

  const setVisibleState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const stopTimers = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (token: number) => {
    if (token !== runToken.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from whatever is currently visible toward the next target
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      const start = () => {
        if (token !== runToken.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed: number) => functionToBeRunEachFrame(elapsed, token),
          latest.current.duration,
        );
      };

      if (latest.current.delay) {
        delayID.current = setTimeout(start, latest.current.delay);
      } else {
        start();
      }
    } else if (latest.current.onEnd) {
      latest.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, token: number) => {
    // A superseded run must never render or complete after being replaced
    if (token !== runToken.current) return;
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = latest.current.duration;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setVisibleState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(token);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setVisibleState(interpolator.current(latest.current.ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runToken.current);
    }

    // Clean up the animation loop
    return () => {
      runToken.current += 1;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstDataEffect = React.useRef(true);

  React.useEffect(() => {
    // The mount effect above already handles the initial queue
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }
    // Supersede any in-flight run: cancel its timers and invalidate its token
    // so it can never render or complete later, then start a replacement run
    // from the currently visible style toward the new data.
    runToken.current += 1;
    stopTimers();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runToken.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
