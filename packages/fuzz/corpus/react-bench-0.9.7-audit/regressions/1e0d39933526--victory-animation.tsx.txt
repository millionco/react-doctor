// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 1e0d399335261309d95429ecddb416ff444dea95dbe26d9ca538dc90aa86029c
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

export type AnimationStyle = { [key: string]: string | number };
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
  const initialData = React.useMemo(() => {
    return Array.isArray(data) ? data[0] : data;
  }, []);
  const initialQueue = React.useMemo(() => {
    return Array.isArray(data) ? data.slice(1) : [];
  }, []);

  const [state, setState] = React.useState<VictoryAnimationState>({
    data: initialData,
    animationInfo: {
      progress: 0,
      animating: false,
    },
  });

  const timer = React.useContext(TimerContext).animationTimer;

  const queue = React.useRef<AnimationStyle[]>(initialQueue);
  const interpolator = React.useRef<null | ((v: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = React.useRef(0);

  const stateDataRef = React.useRef<AnimationStyle>(state.data);
  React.useEffect(() => {
    stateDataRef.current = state.data;
  }, [state.data]);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);

  React.useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  React.useEffect(() => {
    easingRef.current = easing;
  }, [easing]);
  React.useEffect(() => {
    delayRef.current = delay;
  }, [delay]);
  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const clearTimers = React.useCallback(() => {
    if (delayTimeout.current !== null) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = null;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  }, [timer]);

  const traverseQueue = React.useCallback(
    (gen: number) => {
      if (gen !== generation.current) {
        return;
      }
      if (queue.current.length === 0) {
        if (onEndRef.current) {
          onEndRef.current();
        }
        return;
      }

      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(stateDataRef.current, nextData);

      const startSubscription = () => {
        if (gen !== generation.current) {
          return;
        }
        if (loopID.current !== undefined) {
          timer.unsubscribe(loopID.current);
        }
        const callback = (elapsed: number) => {
          if (gen !== generation.current) {
            return;
          }
          if (!interpolator.current) {
            return;
          }
          const currentDuration = durationRef.current;
          const currentEasing = easingRef.current;
          const easeName = formatAnimationName(currentEasing);
          const easeLookup = d3Ease as unknown as Record<string, (t: number) => number>;
          const easeFn = easeLookup[easeName] || easeLookup[formatAnimationName("quadInOut")];
          const step = currentDuration ? elapsed / currentDuration : 1;

          if (step >= 1) {
            const finalData = interpolator.current(1);
            stateDataRef.current = finalData;
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

          const eased = easeFn(step);
          const interpData = interpolator.current(eased);
          stateDataRef.current = interpData;
          setState({
            data: interpData,
            animationInfo: {
              progress: step,
              animating: step < 1,
            },
          });
        };
        loopID.current = timer.subscribe(callback, durationRef.current);
      };

      const currentDelay = delayRef.current;
      if (currentDelay) {
        delayTimeout.current = setTimeout(() => {
          delayTimeout.current = null;
          startSubscription();
        }, currentDelay);
      } else {
        startSubscription();
      }
    },
    [timer],
  );

  const isFirstDataEffect = React.useRef(true);

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue(generation.current);
    }
    return () => {
      generation.current += 1;
      if (delayTimeout.current !== null) {
        clearTimeout(delayTimeout.current);
        delayTimeout.current = null;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
  }, []);

  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }
    generation.current += 1;
    const gen = generation.current;
    clearTimers();
    queue.current = Array.isArray(data) ? data.slice() : [data];
    traverseQueue(gen);
  }, [data]);

  return children(state.data, state.animationInfo);
};
