// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d2f933d62d176361d2d3b5df7f0e3de6ce12777da22fed04d99f0714778fb18a
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

  /**
   * An animation outlives the render that started it, so each frame reads its
   * settings from here rather than from the closure it was created in. That way
   * a run in progress finishes with the latest `duration`, `easing` and `onEnd`
   * instead of the ones that happened to be current when it started.
   */
  const settings = React.useRef({ duration, ease, delay, onEnd });
  settings.current = { duration, ease, delay, onEnd };

  /**
   * The style that is currently rendered. Every step interpolates from this
   * value, so a run that replaces another one continues from what is on screen
   * rather than from a style that was never displayed.
   */
  const currentStyle = React.useRef(state.data);

  /**
   * Identifies the run in progress. A superseded run may still have a frame or
   * a delayed start pending; those check this id so they neither render nor
   * report completion once a newer run has taken over.
   */
  const runID = React.useRef(0);

  /**
   * The `data` the tween queue was built from. Comparing against it lets the
   * effect below tell a real change from the initial value, which is already
   * the starting point of the animation.
   */
  const queuedData = React.useRef(data);

  const renderStyle = (style: AnimationStyle, animationInfo: AnimationInfo) => {
    currentStyle.current = style;
    setState({ data: style, animationInfo });
  };

  const cancelLoop = () => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  /** Abandons the run in progress, invalidating anything it still has pending */
  const supersedeRun = () => {
    runID.current += 1;
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    if (id !== runID.current) {
      return;
    }

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the style being rendered to the next step of the queue
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      // Reset step to zero
      const startLoop = () => {
        if (id !== runID.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(id, elapsed),
          settings.current.duration,
        );
      };

      if (settings.current.delay) {
        delayID.current = setTimeout(startLoop, settings.current.delay);
      } else {
        startLoop();
      }
    } else {
      settings.current.onEnd?.();
    }
  };

  const functionToBeRunEachFrame = (id: number, elapsed: number) => {
    if (id !== runID.current || !interpolator.current) {
      return;
    }

    const { duration: currentDuration, ease: currentEase } = settings.current;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      renderStyle(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      cancelLoop();
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    renderStyle(interpolator.current(currentEase(step)), {
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
      // Nothing left of this animation may run once the component is gone
      supersedeRun();
      if (loopID.current) {
        cancelLoop();
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (queuedData.current === data) {
      // The initial data is already rendered, so there is nothing to animate
      return;
    }
    queuedData.current = data;

    // Whatever is in flight is now animating towards a target that is no longer
    // wanted, so drop it where it is instead of finishing it
    supersedeRun();
    cancelLoop();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? [...data] : [data];
    // Start traversing the tween queue, continuing from the current style
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
