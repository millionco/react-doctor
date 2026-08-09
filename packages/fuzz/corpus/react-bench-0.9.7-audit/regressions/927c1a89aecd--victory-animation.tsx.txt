// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 927c1a89aecd48393051b576b4e9c2c503583bdbc6fa0e45eab0ffcc0ede234c
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

  // The style currently on screen. Unlike `state.data`, this ref is always
  // up to date, even inside long-lived timer callbacks that were created on
  // a previous render, so a mid-flight redirect always starts from exactly
  // what is visible rather than a stale render's snapshot.
  const currentStyle = React.useRef<AnimationStyle>(initialStyle);
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Identifies the run (tween or tween queue) currently in flight. Any timer
  // or delay callback captures the ID that was active when it was scheduled;
  // if that ID no longer matches by the time the callback fires, the run it
  // belongs to has been superseded, so the callback is a no-op. This is what
  // guarantees a superseded run can neither render nor complete later.
  const runID = React.useRef(0);
  // The `data` prop this component has already reacted to, used to tell a
  // genuine prop change apart from React re-invoking the effect for other
  // reasons (e.g. StrictMode's mount/cleanup/mount replay) without treating
  // the latter as a real change that should restart the animation.
  const handledData = React.useRef(data);

  // Latest-value refs so that in-progress animations pick up new duration,
  // easing, and onEnd on their very next tick instead of finishing out the
  // values that were current when they started.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef(d3Ease[formatAnimationName(easing)]);
  const onEndRef = React.useRef(onEnd);
  React.useEffect(() => {
    durationRef.current = duration;
    easeRef.current = d3Ease[formatAnimationName(easing)];
    onEndRef.current = onEnd;
  });

  const startStep = (myRunID: number) => {
    if (myRunID !== runID.current) return;

    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }

    const startValue = currentStyle.current;
    const endValue = queue.current[0];
    const interpolate = victoryInterpolator(startValue, endValue);

    const handleFrame = (elapsed: number) => {
      if (myRunID !== runID.current) return;

      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const currentDuration = durationRef.current;
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalStyle = interpolate(1);
        currentStyle.current = finalStyle;
        if (loopID.current) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }
        setState({
          data: finalStyle,
          animationInfo: {
            progress: 1,
            animating: false,
            terminating: true,
          },
        });
        queue.current.shift();
        startStep(myRunID);
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const frameStyle = interpolate(easeRef.current(step));
      currentStyle.current = frameStyle;
      setState({
        data: frameStyle,
        animationInfo: {
          progress: step,
          animating: true,
        },
      });
    };

    if (delay) {
      delayID.current = setTimeout(() => {
        if (myRunID !== runID.current) return;
        delayID.current = undefined;
        loopID.current = timer.subscribe(handleFrame, durationRef.current);
      }, delay);
    } else {
      loopID.current = timer.subscribe(handleFrame, durationRef.current);
    }
  };

  React.useEffect(() => {
    const isGenuineChange = data !== handledData.current;
    handledData.current = data;

    runID.current += 1;
    if (isGenuineChange) {
      // Hand off from whatever style is currently visible toward the new
      // data, discarding any remaining steps from the superseded queue so
      // the old target is never rendered or completed.
      queue.current = Array.isArray(data) ? data.slice() : [data];
      startStep(runID.current);
    } else if (queue.current.length) {
      // Initial mount with array data: `state`/`currentStyle` already start
      // at `data[0]`, so only the remaining queued steps need to animate.
      // The length check keeps us from firing `onEnd` for a non-array (or
      // single-element) `data` prop that isn't animating at all on mount.
      startStep(runID.current);
    }

    return () => {
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (delayID.current) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
