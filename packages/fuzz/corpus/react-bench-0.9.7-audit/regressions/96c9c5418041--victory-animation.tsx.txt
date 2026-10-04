// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 96c9c54180416d5923bbbda03bbe9b0ec6928e735140ad7c2c9388bd8cb96172
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
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for latest mutable props to adopt changes mid-run
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easingRef = React.useRef(easing);
  const onEndRef = React.useRef(onEnd);
  const stateRef = React.useRef(state);
  const mountedRef = React.useRef(true);
  const firstDataEffect = React.useRef(true);

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);
  React.useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  React.useEffect(() => {
    delayRef.current = delay;
  }, [delay]);
  React.useEffect(() => {
    easingRef.current = easing;
  }, [easing]);
  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const clearDelay = React.useCallback(() => {
    if (delayTimeout.current !== null) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = null;
    }
  }, []);

  const traverseQueue = React.useCallback(() => {
    if (!mountedRef.current) return;
    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(
        stateRef.current.data,
        nextData,
      );

      const start = () => {
        delayTimeout.current = null;
        if (!mountedRef.current) return;
        // Ensure any previous loop is cleared before new subscription
        if (loopID.current) {
          timer.unsubscribe(loopID.current);
          loopID.current = undefined;
        }

        const frame = (elapsed: number) => {
          if (!mountedRef.current) return;
          if (!interpolator.current) return;

          const d = durationRef.current;
          const step = d ? elapsed / d : 1;

          if (step >= 1) {
            const finalData = interpolator.current(1);
            const newState: VictoryAnimationState = {
              data: finalData,
              animationInfo: {
                progress: 1,
                animating: false,
                terminating: true,
              },
            };
            stateRef.current = newState;
            if (mountedRef.current) {
              setState(newState);
            }
            if (loopID.current) {
              timer.unsubscribe(loopID.current);
              loopID.current = undefined;
            }
            queue.current.shift();
            traverseQueue();
            return;
          }

          const easeName = easingRef.current;
          const easeFn =
            (d3Ease as any)[formatAnimationName(easeName)] ||
            ((t: number) => t);
          const eased = easeFn(step);
          const currentData = interpolator.current(eased);
          const newState: VictoryAnimationState = {
            data: currentData,
            animationInfo: {
              progress: step,
              animating: step < 1,
            },
          };
          stateRef.current = newState;
          if (mountedRef.current) {
            setState(newState);
          }
        };

        loopID.current = timer.subscribe(frame, durationRef.current);
      };

      if (delayRef.current) {
        clearDelay();
        delayTimeout.current = setTimeout(start, delayRef.current);
      } else {
        start();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  }, [timer, clearDelay]);

  React.useEffect(() => {
    mountedRef.current = true;
    // Initial mount: if there is a queued array, start it
    if (queue.current.length) {
      traverseQueue();
    }

    return () => {
      mountedRef.current = false;
      clearDelay();
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (firstDataEffect.current) {
      firstDataEffect.current = false;
      return;
    }
    // Interrupt current animation, do NOT flash superseded target
    clearDelay();
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    // Replace queue with latest data, starting from current visible style
    queue.current = Array.isArray(data) ? [...data] : [data as AnimationStyle];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
