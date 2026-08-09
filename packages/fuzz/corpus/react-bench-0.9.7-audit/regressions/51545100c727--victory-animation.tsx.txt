// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 51545100c727b740a440b6966ba627f3888cb5f2d917c4ade5081e765566b588
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
  // Track the `data` this instance was first rendered with, and whether it's
  // ever been replaced, so a genuine replacement (even one that happens to
  // land back on that original value or object reference) is never confused
  // with React re-running the initial mount effect (e.g. Strict Mode).
  const initialData = React.useRef<AnimationData | undefined>(undefined);
  const hasReplacedData = React.useRef(false);
  const ease = d3Ease[formatAnimationName(easing)];

  // A running animation reads duration/easing/onEnd from these refs on every
  // frame (or on completion) instead of from the props closed over when it
  // was subscribed, so changing them mid-run takes effect immediately.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(ease);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  React.useEffect(() => {
    durationRef.current = duration;
    easeRef.current = ease;
    delayRef.current = delay;
    onEndRef.current = onEnd;
  });

  const traverseQueue = (fromStyle: AnimationStyle) => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(fromStyle, nextData);

      const subscribe = () => {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayID.current = setTimeout(subscribe, delayRef.current);
      } else {
        subscribe();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const currentDuration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      setState({
        data: finalStyle,
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
      traverseQueue(finalStyle);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    setState({
      data: interpolator.current(easeRef.current(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    if (initialData.current === undefined) {
      initialData.current = data;
    } else if (!hasReplacedData.current && data !== initialData.current) {
      hasReplacedData.current = true;
    }

    if (hasReplacedData.current) {
      // A real replacement: set the tween queue to the new data and continue
      // from whatever style is currently on screen, so this hands off
      // smoothly instead of snapping to the old target.
      queue.current = Array.isArray(data) ? data : [data];
      traverseQueue(state.data);
    } else if (queue.current.length) {
      // The initial mount (queue already seeded with `data.slice(1)`), or
      // React re-running that same initial effect (e.g. Strict Mode) without
      // any real data change in between - avoid triggering `onEnd` below for
      // a `data` that was never going to animate in the first place.
      traverseQueue(state.data);
    }

    // Clean up the animation loop and any pending delayed start, so a
    // superseded run can't render or complete later, and so unmounting
    // stops the active timer.
    return () => {
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
