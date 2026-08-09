// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 4ffff5e1dbad1f87c6c4ce53db6e90e432956e60681a438c346029e76f648d35
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

  // The timer captures a frame callback at subscribe time, so an animation
  // that is already in flight would otherwise keep using the settings it
  // started with. Route every setting through a ref that is refreshed on each
  // render so the running animation always reads the latest values.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  delayRef.current = delay;
  onEndRef.current = onEnd;

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
  // The style currently on screen. Tracked synchronously (alongside `setState`)
  // so a new tween can pick up from wherever the animation actually is, without
  // waiting for React to re-render.
  const currentData = React.useRef<AnimationStyle>(state.data);
  // Identifies the active run. Any callback carrying a stale token belongs to a
  // superseded run and must neither render nor complete.
  const activeRun = React.useRef(0);

  // Update the visible style and animation info together.
  const commit = (nextData: AnimationStyle, animationInfo: AnimationInfo) => {
    currentData.current = nextData;
    setState({ data: nextData, animationInfo });
  };

  // Tear down the active loop and any pending delayed start.
  const stop = () => {
    if (timeoutID.current !== undefined) {
      clearTimeout(timeoutID.current);
      timeoutID.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, runToken: number) => {
    // Ignore frames belonging to a run that has since been superseded.
    if (runToken !== activeRun.current) return;
    if (!interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      commit(interpolator.current(1), {
        progress: 1,
        animating: false,
        terminating: true,
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(runToken);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    commit(interpolator.current(easeRef.current(step)), {
      progress: step,
      animating: step < 1,
    });
  };

  const traverseQueue = (runToken: number) => {
    // A newer run has taken over; abandon this one.
    if (runToken !== activeRun.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the style currently on screen toward the next target.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const start = () => {
        // The delayed start may fire after a handoff; bail if superseded.
        if (runToken !== activeRun.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, runToken),
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

  // Distinguishes the initial mount from subsequent `data` updates. The mount
  // seeds `state.data` with the first datum and queues the remainder, whereas
  // an update re-tweens through the entire new `data` from the visible style.
  const didInit = React.useRef(false);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      activeRun.current += 1;
      traverseQueue(activeRun.current);
    }

    // Clean up the animation loop so a completion cannot fire after unmount.
    return () => {
      activeRun.current += 1;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The mount effect handles the first render; only react to real updates.
    if (!didInit.current) {
      didInit.current = true;
      return;
    }

    // A new target arrived. Supersede the in-flight run (so it can neither
    // render nor complete), then hand off from the visible style toward the
    // new data without flashing the superseded target.
    activeRun.current += 1;
    stop();
    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueue(activeRun.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
