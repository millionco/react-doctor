// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit f8a6891858dd54255b44bab4cb1189b04bfd23567ef6856035afd0b181864de9
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

/**
 * The settings a running animation reads as it goes, rather than the ones it
 * happened to start with.
 */
interface AnimationSettings {
  duration: number;
  delay: number;
  ease: (step: number) => number;
  onEnd?: () => void;
}

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

  /**
   * Settings are read from a ref on every frame instead of from the closure of
   * the render that started the animation, so that an animation already in
   * flight finishes with the latest props rather than outdated ones.
   */
  const latestSettings: AnimationSettings = {
    duration,
    delay,
    ease: d3Ease[formatAnimationName(easing)],
    onEnd,
  };
  const settings = React.useRef(latestSettings);
  settings.current = latestSettings;

  /**
   * The style that is currently rendered. Every tween starts here, so an
   * animation that replaces an unfinished one continues from what is on screen
   * instead of snapping to the style it was superseded by.
   */
  const currentData = React.useRef(state.data);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /**
   * Identifies the animation that is allowed to render and to call `onEnd`.
   * Handing off to new data bumps it, which retires the frames, delayed starts
   * and queued steps that belong to the superseded animation.
   */
  const runID = React.useRef(0);
  const isInitialData = React.useRef(true);

  React.useEffect(() => {
    if (isInitialData.current) {
      isInitialData.current = false;
      // The queue already holds everything that follows the initial style.
      // Length check prevents us from triggering `onEnd` in `traverseQueue`.
      if (!queue.current.length) {
        return;
      }
    } else {
      // Set the tween queue to the new data. Copying it keeps the queue from
      // mutating the `data` prop as it is traversed.
      queue.current = Array.isArray(data) ? data.slice() : [data];
    }

    // Retire the animation in progress and start traversing the tween queue
    stopAnimation();
    runID.current += 1;
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      // Retire the animation so it can neither render nor complete once the
      // component is gone.
      runID.current += 1;
      stopAnimation();
      if (loopID.current === undefined) {
        timer.stop();
      }
      // Should the effects run again (as they do in strict mode), the queue is
      // still the one built from the initial data.
      isInitialData.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAnimation = () => {
    // Cancel a start that is still waiting out its delay
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    // Cancel existing loop if it exists
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
    }
  };

  const traverseQueue = (id: number) => {
    // A newer animation has taken over, so this one is done making changes.
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the style on screen to the next data in the queue
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const startLoop = () => {
        if (id !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(id, elapsed),
          settings.current.duration,
        );
      };

      // Reset step to zero
      if (settings.current.delay) {
        delayID.current = setTimeout(startLoop, settings.current.delay);
      } else {
        startLoop();
      }
    } else if (settings.current.onEnd) {
      // Only the animation that is still current completes, and it does so
      // with the callback it has at that moment rather than an outdated one.
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (id: number, elapsed: number) => {
    if (id !== runID.current || !interpolator.current) return;

    const { duration: currentDuration, ease } = settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      commit(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    commit(interpolator.current(ease(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const commit = (
    nextData: AnimationStyle,
    animationInfo: AnimationInfo,
  ): void => {
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  return children(state.data, state.animationInfo);
};
