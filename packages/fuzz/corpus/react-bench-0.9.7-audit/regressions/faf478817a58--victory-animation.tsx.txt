// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit faf478817a58808248a438776f07737ea79eb908a097c840ec7debf70ae94a19
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
  // Incremented whenever the active run is superseded (new `data` or unmount)
  // so anything the stale run scheduled can tell it has been replaced and
  // must neither render nor complete.
  const runID = React.useRef(0);
  // The style most recently handed to `children`, so a replacement run can
  // continue from exactly what is visible instead of the superseded target.
  const visibleData = React.useRef(state.data);
  const didMount = React.useRef(false);
  const ease = d3Ease[formatAnimationName(easing)];

  // In-flight runs read settings through this ref so they always honor the
  // latest `duration`, `easing`, and `onEnd` props rather than the values
  // captured when the run was subscribed.
  const latestProps = React.useRef({ duration, delay, onEnd, ease });
  latestProps.current = { duration, delay, onEnd, ease };

  const setVisibleState = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const stopAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
    }
  };

  const traverseQueue = (run: number) => {
    if (run !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from whatever style is currently visible
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      const subscribeFrames = () => {
        loopID.current = timer.subscribe(
          (elapsed, subscribedDuration) =>
            functionToBeRunEachFrame(run, elapsed, subscribedDuration),
          latestProps.current.duration,
        );
      };

      // Reset step to zero
      if (latestProps.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          if (run === runID.current) {
            subscribeFrames();
          }
        }, latestProps.current.delay);
      } else {
        subscribeFrames();
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    run: number,
    elapsed: number,
    subscribedDuration?: number,
  ) => {
    if (run !== runID.current || !interpolator.current) return;

    // The timer zeroes a subscription's duration when animation is bypassed;
    // otherwise honor the latest duration prop, even mid-run
    const activeDuration =
      subscribedDuration === 0 ? 0 : latestProps.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      setVisibleState(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(run);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setVisibleState(interpolator.current(latestProps.current.ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop
    return () => {
      didMount.current = false;
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
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    // New data supersedes the in-progress run: stop it so it can neither
    // render nor complete later, and start a replacement run toward the new
    // data from the currently visible style
    runID.current += 1;
    stopAnimation();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data.slice() : [data];
    // Start traversing the tween queue
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
