// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1d60aae4c5d0ca9d9024f5e5618884146e887517c410f91a737b6837c3e2bc08
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
  const timeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Monotonically increasing id identifying the current run. It is bumped
  // whenever new `data` arrives (or on unmount) so that a superseded run's
  // queued frames and pending delayed starts turn into no-ops: they must
  // neither render nor complete once a newer run has taken over.
  const generation = React.useRef(0);

  // The last `data` prop we reconciled against. Comparing against it lets us
  // tell an initial mount apart from a genuine `data` change, and stays correct
  // under StrictMode's mount → cleanup → mount double-invocation.
  const previousData = React.useRef(data);

  // A synchronous mirror of `state` so callbacks can read the currently visible
  // style immediately, without waiting for the next render.
  const stateRef = React.useRef(state);

  // Keep the most recent animation settings available to an in-flight run so it
  // adopts the latest `duration`, `easing`, `delay`, and `onEnd` rather than the
  // values captured when it started.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Commit new state through here so `stateRef` stays in lock-step with `state`.
  const commit = (next: VictoryAnimationState) => {
    stateRef.current = next;
    setState(next);
  };

  const functionToBeRunEachFrame = (elapsed: number, runGeneration: number) => {
    // A newer `data` (or an unmount) has superseded this run: bail out so it can
    // neither render nor complete on the superseded run's behalf.
    if (runGeneration !== generation.current) return;
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = durationRef.current ? elapsed / durationRef.current : 1;

    if (step >= 1) {
      commit({
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
    commit({
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

      // Interpolate from the currently visible style toward the next target so
      // a hand-off continues from where the previous run left off.
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      // Capture the generation now so a start that lands after newer `data`
      // arrives (in particular a delayed start) is discarded.
      const runGeneration = generation.current;
      const startLoop = () => {
        if (runGeneration !== generation.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runGeneration),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        timeoutID.current = setTimeout(startLoop, delayRef.current);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop on unmount so a queued frame or a pending
    // delayed start can neither render nor fire `onEnd` after we are gone.
    return () => {
      generation.current += 1;
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial mount is handled above; only react to genuine `data` changes.
    if (previousData.current === data) {
      return;
    }
    previousData.current = data;

    // Supersede the in-flight run: its queued frames and any pending delayed
    // start become no-ops, so it cannot flash its (now outdated) target or
    // complete. Only this replacement run may render or complete.
    generation.current += 1;
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    timer.unsubscribe(loopID.current);

    // Set the tween queue to the new data and start traversing it from the
    // currently visible style.
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
