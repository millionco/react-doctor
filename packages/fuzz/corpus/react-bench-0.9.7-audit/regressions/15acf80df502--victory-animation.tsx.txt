// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 15acf80df50292173c2c267e54e6e2a1d30dac1d8cec66b6a8786d81cb4e22f9
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

  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = React.useRef(0);

  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easingRef.current = easing;
  delayRef.current = delay;
  onEndRef.current = onEnd;

  const currentDataRef = React.useRef<AnimationStyle>(state.data);
  currentDataRef.current = state.data;

  const isFirstDataEffect = React.useRef(true);
  const mounted = React.useRef(true);

  const traverseQueue = React.useCallback(() => {
    const myGen = gen.current;
    if (queue.current.length) {
      const nextData = queue.current[0];
      interpolator.current = victoryInterpolator(currentDataRef.current, nextData);

      const startLoop = () => {
        if (gen.current !== myGen) return;
        if (!mounted.current) return;
        delayTimeout.current = null;
        loopID.current = timer.subscribe(
          (elapsed: number) => {
            if (gen.current !== myGen) return;
            if (!mounted.current) return;
            if (!interpolator.current) return;

            const dur = durationRef.current;
            const eName = easingRef.current;
            const easeFn =
              d3Ease[formatAnimationName(eName)] || ((t: number) => t);
            const step = dur ? elapsed / dur : 1;

            if (step >= 1) {
              const finalData = interpolator.current!(1);
              currentDataRef.current = finalData;
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
              traverseQueue();
              return;
            }

            const eased = easeFn(step);
            const frameData = interpolator.current!(eased);
            currentDataRef.current = frameData;
            setState({
              data: frameData,
              animationInfo: {
                progress: step,
                animating: step < 1,
              },
            });
          },
          durationRef.current,
        );
      };

      if (delayRef.current) {
        delayTimeout.current = setTimeout(startLoop, delayRef.current);
      } else {
        startLoop();
      }
    } else if (onEndRef.current) {
      onEndRef.current();
    }
  }, [timer]);

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      mounted.current = false;
      gen.current++;
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
        delayTimeout.current = null;
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        try {
          timer.stop();
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }
    gen.current++;
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = null;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    queue.current = Array.isArray(data)
      ? (data as AnimationStyle[]).slice()
      : [data as AnimationStyle];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
