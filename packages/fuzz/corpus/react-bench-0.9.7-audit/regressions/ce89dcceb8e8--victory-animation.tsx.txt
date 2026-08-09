// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit ce89dcceb8e8c92663d79e28f6d2a90e7fcc94f434ae51a4a27cf099fcb1020f
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
  const visibleData = React.useRef<AnimationStyle>(
    Array.isArray(data) ? data[0] : data,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayedStart = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >();
  const runID = React.useRef(0);
  const mounted = React.useRef(false);
  const settings = React.useRef({ duration, easing, onEnd });
  settings.current = { duration, easing, onEnd };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }
    mounted.current = true;

    // Clean up the animation loop
    return () => {
      runID.current += 1;
      if (delayedStart.current) clearTimeout(delayedStart.current);
      timer.unsubscribe(loopID.current);
      timer.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!mounted.current) return;
    // A prop update supersedes the old run. The visible value is the new start,
    // so the old target is never briefly committed.
    runID.current += 1;
    if (delayedStart.current) clearTimeout(delayedStart.current);
    timer.unsubscribe(loopID.current);
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(runID.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = (id: number) => {
    if (id !== runID.current) return;
    if (queue.current.length) {
      const nextData = queue.current[0];
      const interpolator = victoryInterpolator(visibleData.current, nextData);

      // Reset step to zero
      const start = () => {
        if (id === runID.current) {
          loopID.current = timer.subscribe(
            (elapsed) => functionToBeRunEachFrame(elapsed, id, interpolator),
            settings.current.duration,
          );
        }
      };
      if (delay) {
        delayedStart.current = setTimeout(start, delay);
      } else {
        start();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    id: number,
    interpolator: (value: number) => AnimationStyle,
  ) => {
    if (id !== runID.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = settings.current.duration
      ? elapsed / settings.current.duration
      : 1;
    const ease = d3Ease[formatAnimationName(settings.current.easing)];

    if (step >= 1) {
      setState({
        data: interpolator(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      visibleData.current = interpolator(1);
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setState({
      data: interpolator(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
    visibleData.current = interpolator(ease(step));
  };

  return children(state.data, state.animationInfo);
};
