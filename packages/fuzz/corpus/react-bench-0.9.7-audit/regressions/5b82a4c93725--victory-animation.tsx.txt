// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5b82a4c93725e2775d819b4d625424a3d93dde3035f3798064aa8ccf6923c73a
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

  // Mutable animation state that must persist across renders without triggering
  // re-renders of its own.
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  // A monotonically increasing id identifying the currently active run. Any run
  // whose id no longer matches has been superseded (by new props or unmounting)
  // and must neither render another frame nor complete.
  const activeRunID = React.useRef(0);
  // The most recently rendered style, so that a new run can continue from the
  // currently visible values rather than restarting or flashing an old target.
  const currentData = React.useRef(state.data);
  // Lets the data-change effect skip the initial render (handled on mount).
  const isInitialData = React.useRef(true);

  // The latest animation settings are stored in refs so that in-flight runs
  // (whose frame callbacks read these refs instead of closed-over values)
  // always adopt the newest duration, easing, and onEnd.
  const ease = d3Ease[formatAnimationName(easing)];
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = ease;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Update the rendered state while tracking the currently visible style.
  const setAnimationState = (next: VictoryAnimationState) => {
    currentData.current = next.data;
    setState(next);
  };

  const functionToBeRunEachFrame = (runID: number) => (elapsed: number) => {
    // Ignore frames belonging to a run that has since been superseded, so a
    // stale run can neither render nor complete.
    if (runID !== activeRunID.current || !interpolator.current) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1; if this
    // happens set the state to 1 and return, cancelling the timer. The latest
    // `duration` is read from a ref so it can change mid-run.
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setAnimationState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing the
    // current step value transformed by the (latest) ease function to the
    // interpolator, which is cached for performance whenever props change.
    setAnimationState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      // Claim a new run id; this run is now the active one.
      const runID = (activeRunID.current += 1);
      const startRun = () => {
        delayTimeoutID.current = undefined;
        // Bail if this run was superseded while waiting out its delay.
        if (runID !== activeRunID.current) {
          return;
        }
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame(runID),
          durationRef.current,
        );
      };

      // Preserve delayed starts.
      if (delayRef.current) {
        delayTimeoutID.current = setTimeout(startRun, delayRef.current);
      } else {
        startRun();
      }
    } else if (onEndRef.current) {
      // Only the latest onEnd is invoked, and only once the queue completes.
      onEndRef.current();
    }
  };

  // Supersede the active run and tear down any pending frame/delay it owns.
  const supersedeActiveRun = () => {
    activeRunID.current += 1;
    if (delayTimeoutID.current) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up on unmount so a completion cannot fire afterward.
    return () => {
      supersedeActiveRun();
      if (!loopID.current) {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial run is started by the mount effect above.
    if (isInitialData.current) {
      isInitialData.current = false;
      return;
    }

    // Hand off to a new run: supersede the in-flight one (so it neither renders
    // its now-outdated target nor completes), then continue from the currently
    // visible style toward the new data. Only this replacement run will finish.
    supersedeActiveRun();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
