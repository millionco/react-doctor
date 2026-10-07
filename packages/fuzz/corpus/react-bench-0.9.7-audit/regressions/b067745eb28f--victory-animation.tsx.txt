// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b067745eb28f9186acf99132be1ed06a47a899457d3f21a767472b06ddad3dd0
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
  const delayTimeoutID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Mirrors `state`, but updated synchronously so mid-tick chaining (queue
  // hand-off, replacement runs) always reads the just-computed visible style
  // instead of a stale value from the render that's still pending commit.
  const stateRef = React.useRef(state);

  const ease = d3Ease[formatAnimationName(easing)];

  // Latest-value refs so an already-running tween picks up prop changes
  // (duration, easing, onEnd) on its very next frame instead of finishing
  // out the settings that were active when it was subscribed.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const onEndRef = React.useRef(onEnd);

  React.useEffect(() => {
    durationRef.current = duration;
    easeRef.current = ease;
    onEndRef.current = onEnd;
  });

  const setVisibleState = (next: VictoryAnimationState) => {
    stateRef.current = next;
    setState(next);
  };

  const cancelActiveRun = () => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to the next target
      interpolator.current = victoryInterpolator(stateRef.current.data, nextData);

      const startLoop = () => {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delay) {
        delayTimeoutID.current = setTimeout(() => {
          delayTimeoutID.current = undefined;
          startLoop();
        }, delay);
      } else {
        startLoop();
      }
    } else {
      const currentOnEnd = onEndRef.current;
      if (currentOnEnd) currentOnEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      setVisibleState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
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
    const currentEase = easeRef.current;
    setVisibleState({
      data: interpolator.current(currentEase(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      cancelActiveRun();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isInitialDataRef = React.useRef(true);
  React.useEffect(() => {
    const isInitialMount = isInitialDataRef.current;
    isInitialDataRef.current = false;

    if (isInitialMount && Array.isArray(data)) {
      // The mount effect above already started traversing the initial queue.
      return;
    }

    // Cancel whatever the superseded run was doing (in-flight tween or a
    // pending delayed start) before handing off to the new data, so the old
    // run can never render or complete after this point.
    cancelActiveRun();
    // Continue from the currently visible style toward the new data, rather
    // than jumping to the superseded target first.
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
