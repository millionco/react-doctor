// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit b821cf42c466563f3070af3188782befe8fc53a1c1acb927dd284545220faf6b
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";
import isEqual from "react-fast-compare";

/**
 * Single animation object to interpolate
 */
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
  const dataRef = React.useRef<AnimationStyle>(state.data);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(
    null,
  );
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationRef = React.useRef<number>(duration);
  const easingRef = React.useRef<AnimationEasing>(easing);
  const delayRef = React.useRef<number>(delay);
  const onEndRef = React.useRef<typeof onEnd>(onEnd);
  const generationRef = React.useRef<number>(0);
  const isFirstDataEffect = React.useRef<boolean>(true);
  const prevDataRef = React.useRef<AnimationData>(data);

  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;
  dataRef.current = state.data;

  const traverseQueue = React.useCallback(
    (gen: number) => {
      if (gen !== generationRef.current) {
        return;
      }
      if (queue.current.length) {
        const nextData = queue.current[0];
        interpolator.current = victoryInterpolator(dataRef.current, nextData);

        const launch = () => {
          if (gen !== generationRef.current) {
            return;
          }
          delayID.current = null;
          const frame = (elapsed: number) => {
            if (gen !== generationRef.current) {
              if (loopID.current !== undefined) {
                timer.unsubscribe(loopID.current);
                loopID.current = undefined;
              }
              return;
            }
            if (!interpolator.current) {
              return;
            }
            const curDuration = durationRef.current ?? DEFAULT_DURATION;
            const step = curDuration ? elapsed / curDuration : 1;
            const curEasing = easingRef.current ?? "quadInOut";
            const easeMap = d3Ease as Record<string, (t: number) => number>;
            const easeFn: (t: number) => number =
              easeMap[formatAnimationName(curEasing)] ?? ((t: number) => t);

            if (step >= 1) {
              const finalData = interpolator.current(1);
              dataRef.current = finalData;
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
            const curData = interpolator.current(eased);
            dataRef.current = curData;
            setState({
              data: curData,
              animationInfo: {
                progress: step,
                animating: step < 1,
              },
            });
          };

          const curDuration = durationRef.current ?? DEFAULT_DURATION;
          loopID.current = timer.subscribe(frame, curDuration);
        };

        const curDelay = delayRef.current ?? 0;
        if (curDelay) {
          delayID.current = setTimeout(launch, curDelay);
        } else {
          launch();
        }
      } else if (onEndRef.current) {
        onEndRef.current();
      }
    },
    [timer],
  );

  React.useEffect(() => {
    if (queue.current.length) {
      traverseQueue(generationRef.current);
    }

    return () => {
      generationRef.current++;
      if (delayID.current !== null) {
        clearTimeout(delayID.current);
        delayID.current = null;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      prevDataRef.current = data;
      return;
    }

    if (isEqual(prevDataRef.current, data)) {
      // Data hasn't meaningfully changed; keep current animation but refs for duration/easing/onEnd already updated
      return;
    }
    prevDataRef.current = data;

    generationRef.current++;
    const newGen = generationRef.current;

    if (delayID.current !== null) {
      clearTimeout(delayID.current);
      delayID.current = null;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(newGen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
