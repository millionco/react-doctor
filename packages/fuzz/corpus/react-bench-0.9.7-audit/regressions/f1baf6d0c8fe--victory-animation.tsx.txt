// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit f1baf6d0c8feae27c9c27541530da6204d67a41b2c0e20584691bcf56618d20d
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
  const initialStyle = Array.isArray(data) ? data[0] : data;

  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialStyle,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // The style actually on screen right now. Unlike `state.data`, this is
  // always current inside callbacks that were created (and captured stale
  // props) on an earlier render, so it's what a replacement run should
  // treat as its starting point.
  const currentStyle = React.useRef<AnimationStyle>(initialStyle);

  // Bumped every time a run is superseded by a new one, so callbacks
  // belonging to the abandoned run (a pending delayed start, or a timer
  // tick that was already queued for this frame) can recognize they're
  // stale and skip rendering or completing on its behalf.
  const runToken = React.useRef(0);

  // Kept up to date on every render so in-flight callbacks - which were
  // created on whatever render last (re)subscribed them - always read the
  // latest settings instead of the ones captured at subscribe time.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  easeRef.current = d3Ease[formatAnimationName(easing)];

  const cancelPendingWork = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const tick = (token: number) => (elapsed: number) => {
    if (token !== runToken.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalStyle = interpolator.current(1);
      currentStyle.current = finalStyle;
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
      traverseQueue(token);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are
    // received
    const nextStyle = interpolator.current(easeRef.current(step));
    currentStyle.current = nextStyle;
    setState({
      data: nextStyle,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (token: number) => {
    if (token !== runToken.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare the currently visible style to the next target
      interpolator.current = victoryInterpolator(currentStyle.current, nextData);

      const start = () => {
        if (token !== runToken.current) return;
        loopID.current = timer.subscribe(tick(token), durationRef.current);
      };

      // Reset step to zero
      if (delayRef.current) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          start();
        }, delayRef.current);
      } else {
        start();
      }
    } else {
      const callback = onEndRef.current;
      if (callback) callback();
    }
  };

  React.useEffect(() => {
    // Clean up the animation loop
    return () => {
      cancelPendingWork();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Cancel whatever the previous run (or a still-pending delayed start
    // for it) was doing, and start a fresh run token so any of its stale
    // callbacks recognize they've been superseded. On mount this is a
    // no-op cancellation and simply kicks off the first run.
    cancelPendingWork();
    runToken.current += 1;

    // Set the tween queue to the new data. The next interpolation starts
    // from `currentStyle`, i.e. whatever is actually on screen, so there's
    // no flash toward the target of the run being replaced.
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(runToken.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
