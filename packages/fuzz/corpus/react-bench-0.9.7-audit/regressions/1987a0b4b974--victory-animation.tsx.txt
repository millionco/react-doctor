// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1987a0b4b9741de91fb0c79352966704e05e775c6cb4f40e87fd793f42b371ec
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

const getEase = (name: AnimationEasing) => d3Ease[formatAnimationName(name)];

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

  // The queue of remaining styles to animate toward, in order.
  const queueRef = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  // The interpolator for the currently-animating step.
  const interpolatorRef = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  // The active subscription id for the running step.
  const loopIDRef = React.useRef<number | undefined>(undefined);
  // The pending `delay` timeout id (so it can be cancelled).
  const delayTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // A generation counter. Each time the queue is (re)started because `data`
  // changed, the counter is bumped. A step created for an older generation is
  // considered superseded and must not render or complete.
  const runRef = React.useRef(0);
  // Whether the component is still mounted.
  const isMountedRef = React.useRef(true);
  // The most recently rendered (visible) style. New runs always start from this
  // value so a handoff never flashes a superseded target.
  const dataRef = React.useRef<AnimationStyle>(state.data);

  // Keep refs in sync with the latest props/state every render. Active frames
  // read from these refs so an in-progress run always adopts the latest
  // `duration`, `easing`, `delay`, and `onEnd`.
  const timerRef = React.useRef(timer);
  timerRef.current = timer;
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easingRef = React.useRef(easing);
  easingRef.current = easing;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;
  dataRef.current = state.data;

  const clearActiveStep = React.useCallback(() => {
    if (delayTimeoutRef.current) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = undefined;
    }
    if (loopIDRef.current !== undefined) {
      timerRef.current.unsubscribe(loopIDRef.current);
      loopIDRef.current = undefined;
    }
  }, []);

  // Traverse the next item in the queue. Each step interpolates from the
  // currently visible style (`dataRef`) toward `queueRef[0]`. When the queue is
  // empty the run is complete: render the final style and invoke `onEnd`.
  const traverseQueue = React.useCallback(() => {
    if (!isMountedRef.current) return;

    if (queueRef.current.length) {
      const nextData = queueRef.current[0];
      interpolatorRef.current = victoryInterpolator(dataRef.current, nextData);

      // Capture the generation this step belongs to. If `data` changes before
      // the step finishes, `runRef` is bumped and this callback becomes a no-op
      // even if it is somehow still scheduled.
      const run = runRef.current;

      const stepDuration = durationRef.current;
      const frameCallback = (elapsed: number) => {
        // Superseded runs must not render or complete later.
        if (!isMountedRef.current || run !== runRef.current) return;
        const interpolator = interpolatorRef.current;
        if (!interpolator) return;

        // Step can generate imprecise values, sometimes greater than 1; if this
        // happens, finish the step and move to the next queue item.
        const dur = durationRef.current || DEFAULT_DURATION;
        const step = dur ? elapsed / dur : 1;

        if (step >= 1) {
          const finalData = interpolator(1);
          dataRef.current = finalData;
          setState({
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });
          if (loopIDRef.current !== undefined) {
            timerRef.current.unsubscribe(loopIDRef.current);
            loopIDRef.current = undefined;
          }
          queueRef.current.shift();
          traverseQueue();
          return;
        }

        const interpolated = interpolator(getEase(easingRef.current)(step));
        dataRef.current = interpolated;
        setState({
          data: interpolated,
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
      };

      const start = () => {
        if (!isMountedRef.current || run !== runRef.current) return;
        loopIDRef.current = timerRef.current.subscribe(
          frameCallback,
          stepDuration,
        );
      };

      if (delayRef.current) {
        delayTimeoutRef.current = setTimeout(() => {
          delayTimeoutRef.current = undefined;
          start();
        }, delayRef.current);
      } else {
        start();
      }
    } else {
      // The queue is drained: render the final style and invoke the latest
      // `onEnd` exactly once for this run.
      setState({
        data: dataRef.current,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      onEndRef.current?.();
    }
  }, []);

  // Stop the active step (and any pending delayed start) when unmounting so
  // completion can never fire afterward.
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearActiveStep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstRunRef = React.useRef(true);

  React.useEffect(() => {
    if (isFirstRunRef.current) {
      // Initial mount. Build the queue from the initial data: for an array the
      // first element is already shown, so the queue is the remaining items;
      // for a single object we animate toward it (a no-op that still drives
      // `onEnd`, preserving the original load behavior).
      isFirstRunRef.current = false;
      queueRef.current = Array.isArray(data) ? data.slice(1) : [data];
    } else {
      // `data` changed mid-run (or while idle). Hand off from the currently
      // visible style toward the new data without flashing the superseded
      // target. Bumping `runRef` invalidates any in-flight step from the
      // superseded run so it can neither render nor complete.
      clearActiveStep();
      runRef.current = runRef.current + 1;
      queueRef.current = Array.isArray(data) ? data.slice() : [data];
    }
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
