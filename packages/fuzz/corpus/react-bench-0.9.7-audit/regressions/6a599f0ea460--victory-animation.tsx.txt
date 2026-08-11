// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6a599f0ea4607b7719f73bb4637b444f2bcc8cd2bde44d61eb49568d04347391
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import isEqual from "react-fast-compare";
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

  // Latest props — active animations always read these instead of stale closures.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  // Currently visible style, kept in sync so replacements start from here.
  const dataRef = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
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
  // Bumped whenever a run is superseded or the component unmounts.
  const generationRef = React.useRef(0);
  const prevDataRef = React.useRef(data);

  const traverseQueueRef = React.useRef<(generation?: number) => void>(
    () => undefined,
  );

  const clearScheduledWork = React.useCallback(() => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, subscriptionDuration: number, generation: number) => {
      // A newer replacement owns the timeline — ignore this callback.
      if (generation !== generationRef.current || !interpolator.current) {
        return;
      }

      // Respect Timer.bypassAnimation (subscriptionDuration === 0) while still
      // adopting the latest duration prop for an active, non-bypassed run.
      const currentDuration =
        subscriptionDuration === 0 ? 0 : durationRef.current;
      const ease = d3Ease[formatAnimationName(easingRef.current)];

      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator.current(1);
        dataRef.current = finalData;
        setState({
          data: finalData,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        clearScheduledWork();
        queue.current.shift();
        traverseQueueRef.current(generation);
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const nextData = interpolator.current(ease(step));
      dataRef.current = nextData;
      setState({
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [clearScheduledWork],
  );

  traverseQueueRef.current = (generation: number = generationRef.current) => {
    if (generation !== generationRef.current) {
      return;
    }

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached visible style to next queue entry
      interpolator.current = victoryInterpolator(dataRef.current, nextData);

      const start = () => {
        if (generation !== generationRef.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed, subscriptionDuration) =>
            functionToBeRunEachFrame(
              elapsed,
              subscriptionDuration,
              generation,
            ),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        timeoutID.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const replaceQueue = React.useCallback(
    (nextData: AnimationData) => {
      // Invalidate any in-flight timeout/frame so a superseded run cannot
      // render or invoke onEnd after this handoff.
      generationRef.current += 1;
      clearScheduledWork();
      queue.current = Array.isArray(nextData) ? nextData.slice() : [nextData];
      traverseQueueRef.current(generationRef.current);
    },
    [clearScheduledWork],
  );

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current(generationRef.current);
    }

    // Clean up the animation loop
    return () => {
      generationRef.current += 1;
      if (timeoutID.current !== undefined) {
        clearTimeout(timeoutID.current);
        timeoutID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isEqual(prevDataRef.current, data)) {
      return;
    }
    prevDataRef.current = data;
    // Continue from the currently visible style toward the new data without
    // flashing the superseded target; only this replacement run may complete.
    replaceQueue(data);
  }, [data, replaceQueue]);

  return children(state.data, state.animationInfo);
};
