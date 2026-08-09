// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 416474e7500ff4c30d149c70e3cc8196cc2df1004d454b7baf39819e821e43fb
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

/* `useLayoutEffect` warns when rendering on the server. The animation loop
 * only ever runs in environments with a DOM, so the fallback never changes
 * behavior there. */
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

  const context = React.useContext(TimerContext);
  const timer = React.useRef(context.animationTimer).current;
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
  /* The style most recently handed to `children`. Tweens start from this
   * value so an interrupted animation continues from what is currently
   * visible instead of jumping to the end of the superseded run. */
  const visibleData = React.useRef<AnimationStyle>(state.data);

  const ease = d3Ease[formatAnimationName(easing)];

  /* Mirror the latest props so an in-flight animation adopts changes to
   * `duration`, `easing`, `delay`, and `onEnd` rather than finishing with the
   * values captured when its timer subscription was created. This must be
   * kept in sync before the `data` effect below runs. */
  const latest = React.useRef({ duration, delay, ease, onEnd });
  useIsomorphicLayoutEffect(() => {
    latest.current = { duration, delay, ease, onEnd };
  });

  const applyFrame = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ) => {
    visibleData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  const cancelPendingStart = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const startLoop = () => {
    delayID.current = undefined;
    loopID.current = timer.subscribe(
      functionToBeRunEachFrame,
      latest.current.duration,
    );
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Tween from the currently visible style to the next data in the queue
      interpolator.current = victoryInterpolator(visibleData.current, nextData);

      // Reset step to zero
      if (latest.current.delay) {
        delayID.current = setTimeout(startLoop, latest.current.delay);
      } else {
        startLoop();
      }
    } else if (latest.current.onEnd) {
      latest.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    subscribedDuration?: number,
  ) => {
    if (!interpolator.current) return;

    /* A subscription duration of zero means animation was bypassed when this
     * loop started, so jump straight to the end of the tween. Otherwise use
     * the latest `duration` prop so mid-run changes take effect. */
    const activeDuration =
      subscribedDuration === 0 ? 0 : latest.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      applyFrame(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
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
    applyFrame(interpolator.current(latest.current.ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    /* Clean up the animation loop and any pending delayed start so neither
     * a frame nor a completion can fire after unmount */
    return () => {
      cancelPendingStart();
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousData = React.useRef(data);
  /* A layout effect guarantees the superseded run is stopped in the same
   * task as the commit that changed `data`, before another frame can fire. */
  useIsomorphicLayoutEffect(() => {
    /* The guard also keeps this from running on the initial mount, where the
     * queue set up above already holds any array data to animate through. */
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    /* Supersede any in-flight animation: cancel a pending delayed start and
     * stop the active loop so the old run can neither render nor complete.
     * The replacement run below picks up from the currently visible style,
     * so the superseded target is never flashed. */
    cancelPendingStart();
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
    }
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
