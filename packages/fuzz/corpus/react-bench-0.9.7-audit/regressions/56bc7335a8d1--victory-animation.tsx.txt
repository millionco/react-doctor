// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 56bc7335a8d1e328210dbacd4bead368d9913ded612766770f5fd329f9c718c6
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
  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Identifies the run of the tween queue currently allowed to render or
  // complete. Bumped whenever `data` changes so that callbacks belonging to
  // a superseded run (already scheduled timers/timeouts) become no-ops
  // instead of clobbering the replacement run.
  const runID = React.useRef(0);
  // Mirrors whatever style is currently on screen so a replacement run can
  // continue from there instead of from the superseded run's target.
  const currentStyle = React.useRef<AnimationStyle>(state.data);

  // Latest-value refs so a tween already in flight picks up prop changes on
  // its very next frame, rather than running to completion with the
  // duration/easing/onEnd that were active when it started.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  easeRef.current = d3Ease[formatAnimationName(easing)];
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const cancelActive = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (id: number) => {
    // Bail if a later `data` change has already superseded this run.
    if (id !== runID.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Tween from whatever is currently visible toward the next target.
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      const start = () => {
        if (id !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, id),
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayID.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, id: number) => {
    if (id !== runID.current || !interpolator.current) return;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer.
    // Duration is re-read every frame so a live tween adopts prop changes.
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
      traverseQueue(id);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const nextStyle = interpolator.current(easeRef.current(step));
    currentStyle.current = nextStyle;
    setState({
      data: nextStyle,
      animationInfo: {
        progress: step,
        animating: true,
      },
    });
  };

  React.useEffect(() => {
    // A new `data` (including the very first one on mount) supersedes
    // whatever run was previously active, and continues from the style
    // that's currently visible rather than jumping to the old target.
    cancelActive();
    runID.current += 1;
    const id = runID.current;
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(id);

    // Clean up the animation loop so completion cannot fire after unmount.
    return () => {
      cancelActive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
