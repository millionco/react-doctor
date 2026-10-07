// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 3c9bdc551b62dc6e6a1010be3781705ec7ceafdd9e80acfc41657c70445e593e
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

  // Queue holds the pending targets (array-data rest or full replacement)
  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [],
  );
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Refs for latest prop values so in-flight animations adopt them
  const durationRef = React.useRef(duration);
  const delayRef = React.useRef(delay);
  const easeRef = React.useRef<(t: number) => number>(
    (d3Ease as any)[formatAnimationName(easing)] ?? ((t: number) => t),
  );
  const onEndRef = React.useRef(onEnd);

  // Ref for currently visible style (kept in sync with state.data)
  const dataRef = React.useRef<AnimationStyle>(state.data);

  const mountedRef = React.useRef(true);
  const generationRef = React.useRef(0);
  const isFirstMount = React.useRef(true);

  // Keep latest values in refs
  React.useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  React.useEffect(() => {
    const easeFn = (d3Ease as any)[formatAnimationName(easing)];
    easeRef.current = easeFn ?? ((t: number) => t);
  }, [easing]);

  React.useEffect(() => {
    delayRef.current = delay;
  }, [delay]);

  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  React.useEffect(() => {
    dataRef.current = state.data;
  }, [state.data]);

  const cancelExisting = React.useCallback(() => {
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeout.current !== undefined) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(
    (gen: number) => {
      if (gen !== generationRef.current) return;
      if (!mountedRef.current) return;

      if (queue.current.length) {
        const nextData = queue.current[0];
        // Continue from currently visible style toward new data without flashing superseded target
        interpolator.current = victoryInterpolator(dataRef.current, nextData);

        const start = () => {
          delayTimeout.current = undefined;
          if (gen !== generationRef.current) return;
          if (!mountedRef.current) return;

          loopID.current = timer.subscribe((elapsed: number) => {
            if (gen !== generationRef.current) return;
            if (!mountedRef.current) return;
            if (!interpolator.current) return;

            const currentDuration = durationRef.current;
            const step = currentDuration ? elapsed / currentDuration : 1;

            if (step >= 1) {
              const finalData = interpolator.current(1);
              dataRef.current = finalData;
              if (!mountedRef.current) return;
              if (gen !== generationRef.current) return;

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
              traverseQueue(gen);
              return;
            }

            const easeFn = easeRef.current;
            const eased = easeFn ? easeFn(step) : step;
            const currentData = interpolator.current(eased);
            dataRef.current = currentData;
            if (gen !== generationRef.current) return;
            if (!mountedRef.current) return;

            setState({
              data: currentData,
              animationInfo: {
                progress: step,
                animating: step < 1,
              },
            });
          }, durationRef.current);
        };

        if (delayRef.current) {
          delayTimeout.current = setTimeout(start, delayRef.current);
        } else {
          start();
        }
      } else {
        if (gen !== generationRef.current) return;
        if (!mountedRef.current) return;
        if (onEndRef.current) {
          onEndRef.current();
        }
      }
    },
    [timer],
  );

  // Unmount cleanup – stop active timer so completion cannot fire afterward
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelExisting();
    };
  }, [cancelExisting]);

  // Data change handling – replace queue and continue from visible without flashing old target
  React.useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (queue.current.length) {
        traverseQueue(generationRef.current);
      }
      return;
    }

    generationRef.current += 1;
    const gen = generationRef.current;

    cancelExisting();

    queue.current = Array.isArray(data) ? (data as AnimationStyle[]) : [data as AnimationStyle];

    traverseQueue(gen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
