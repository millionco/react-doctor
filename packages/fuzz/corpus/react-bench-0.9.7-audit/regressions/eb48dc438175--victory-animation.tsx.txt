// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit eb48dc43817547ae89555b11280056e863daf9d1191b833eea7549528efa42e0
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
  const initialData = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
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
  const delayTimeoutID = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const prevDataRef = React.useRef(data);
  const mountedRef = React.useRef(true);
  const runIdRef = React.useRef(0);

  // Latest props for in-flight frames — active runs adopt these without restart.
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  // Visible style, updated synchronously so data handoffs never read a stale end.
  const visibleDataRef = React.useRef<AnimationStyle>(initialData);

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const clearActiveTimer = React.useCallback(() => {
    if (delayTimeoutID.current !== undefined) {
      clearTimeout(delayTimeoutID.current);
      delayTimeoutID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const cancelAnimation = React.useCallback(() => {
    runIdRef.current += 1;
    clearActiveTimer();
  }, [clearActiveTimer]);

  const traverseQueueRef = React.useRef<() => void>(() => {});

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number, timedDuration: number) => {
      if (!interpolator.current) return;

      const ease = d3Ease[formatAnimationName(easingRef.current)];
      // Timer passes 0 when animation is bypassed; otherwise use latest duration.
      const currentDuration =
        timedDuration === 0 ? 0 : durationRef.current;
      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = currentDuration ? elapsed / currentDuration : 1;

      if (step >= 1) {
        const finalData = interpolator.current(1);
        visibleDataRef.current = finalData;
        setState({
          data: finalData,
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
        traverseQueueRef.current();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const nextData = interpolator.current(ease(step));
      visibleDataRef.current = nextData;
      setState({
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer],
  );

  traverseQueueRef.current = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];
      const runId = runIdRef.current;

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(
        visibleDataRef.current,
        nextData,
      );

      const subscribe = () => {
        if (runId !== runIdRef.current || !mountedRef.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed, timedDuration) => {
            if (runId !== runIdRef.current || !mountedRef.current) {
              return;
            }
            functionToBeRunEachFrame(elapsed, timedDuration);
          },
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayTimeoutID.current = setTimeout(subscribe, delayRef.current);
      } else {
        subscribe();
      }
    } else if (onEndRef.current && mountedRef.current) {
      onEndRef.current();
    }
  };

  React.useEffect(() => {
    mountedRef.current = true;
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueueRef.current();
    }

    // Clean up the animation loop so completion cannot fire after unmount
    return () => {
      mountedRef.current = false;
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Skip the initial mount; the effect above starts any queued array steps.
    if (prevDataRef.current === data) {
      return;
    }
    prevDataRef.current = data;

    // Continue from the currently visible style toward the new data without
    // flashing the superseded target. Only this replacement run may complete.
    cancelAnimation();
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueueRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
