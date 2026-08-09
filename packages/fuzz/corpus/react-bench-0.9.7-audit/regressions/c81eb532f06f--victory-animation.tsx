// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c81eb532f06f61d1d0dee09e1fc19f7ecd9ed6ba86beefce2bf05503037524e8
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

  // Keep the latest values of the props that can change mid-animation in refs
  // so that an in-progress run always reads the current `duration`, `easing`,
  // `onEnd`, and `delay` rather than the values captured when it started.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const delayRef = React.useRef(delay);
  durationRef.current = duration;
  easingRef.current = easing;
  onEndRef.current = onEnd;
  delayRef.current = delay;

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The currently visible (rendered) style. Interpolation always continues from
  // here, so a handoff to new data starts from what is on screen — never from a
  // superseded target.
  const currentData = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  // Monotonically increasing token identifying the active run. Any frame or
  // delayed start belonging to an older generation must not render or complete.
  const generation = React.useRef(0);
  const isFirstRun = React.useRef(true);

  React.useEffect(() => {
    // Clean up the animation loop on unmount so a queued frame can never fire
    // (and complete) after the component is gone.
    return () => {
      generation.current += 1;
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
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
    // Supersede any in-flight run: invalidate its generation, cancel its
    // pending delayed start, and unsubscribe its frame loop. The old run will
    // neither render nor complete after this point.
    generation.current += 1;
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    if (isFirstRun.current) {
      // On mount, array data is displayed at its first entry and animates
      // through the remainder of the queue. Single data has nothing to tween,
      // so it is simply displayed.
      isFirstRun.current = false;
      if (Array.isArray(data)) {
        queue.current = data.slice(1);
        traverseQueue();
      }
      return;
    }

    // On a change, continue from the currently visible style toward the new
    // data. For array data every entry is queued, preserving order.
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      // Tag this step with the active generation so a superseded run started
      // during the delay window bails out.
      const runGeneration = generation.current;
      const begin = () => {
        if (runGeneration !== generation.current) {
          return;
        }
        const subscriptionID = timer.subscribe(
          (elapsed) =>
            functionToBeRunEachFrame(elapsed, runGeneration, subscriptionID),
          durationRef.current,
        );
        loopID.current = subscriptionID;
      };

      if (delayRef.current) {
        delayTimeout.current = setTimeout(begin, delayRef.current);
      } else {
        begin();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    runGeneration: number,
    subscriptionID: number,
  ) => {
    // A superseded run must not render or complete; just tear down its loop.
    if (runGeneration !== generation.current) {
      timer.unsubscribe(subscriptionID);
      return;
    }

    if (!interpolator.current) return;

    // Read the latest duration/easing so a prop change mid-run takes effect.
    const currentDuration = durationRef.current;
    const ease = d3Ease[formatAnimationName(easingRef.current)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      currentData.current = finalData;

      timer.unsubscribe(subscriptionID);
      loopID.current = undefined;

      queue.current.shift();
      const hasMore = queue.current.length > 0;

      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: hasMore,
          terminating: !hasMore,
        },
      });

      // Advance to the next queued step, or resolve `onEnd` when finished.
      traverseQueue();
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const nextData = interpolator.current(ease(step));
    currentData.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
