// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit c85064bf3753be881d52c887c4e18c1b8008dfcf7e4f7717c9c6c63f66a919cd
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
  const timeoutID = React.useRef<any>(undefined);

  const propsRef = React.useRef({ duration, easing, onEnd, delay, data });
  // Also keep a ref of the current visible data to hand-off without flashing
  const currentStateRef = React.useRef(state.data);
  // Keep track if we are currently unmounted
  const unmounted = React.useRef(false);

  // Sync refs so active animation uses latest duration/easing/onEnd without restarting
  React.useEffect(() => {
    propsRef.current = { duration, easing, onEnd, delay, data };
    currentStateRef.current = state.data;
  });

  const traverseQueue = React.useCallback(
    (startData: AnimationStyle) => {
      if (unmounted.current) return;

      if (queue.current.length) {
        const nextData = queue.current[0];
        interpolator.current = victoryInterpolator(startData, nextData);

        const startTimer = () => {
          if (unmounted.current) return;
          loopID.current = timer.subscribe((elapsed: number) => {
            if (!interpolator.current) return;
            const currentDuration =
              propsRef.current.duration ?? DEFAULT_DURATION;
            const currentEasing =
              d3Ease[
                formatAnimationName(propsRef.current.easing ?? "quadInOut")
              ];

            const step = currentDuration ? elapsed / currentDuration : 1;

            if (step >= 1) {
              const finalData = interpolator.current(1);
              setState({
                data: finalData,
                animationInfo: {
                  progress: 1,
                  animating: false,
                  terminating: true,
                },
              });
              if (loopID.current) timer.unsubscribe(loopID.current);
              queue.current.shift();
              traverseQueue(finalData);
              return;
            }

            setState({
              data: interpolator.current(currentEasing(step)),
              animationInfo: {
                progress: step,
                animating: step < 1,
              },
            });
          }, propsRef.current.duration ?? DEFAULT_DURATION);
        };

        if (propsRef.current.delay) {
          timeoutID.current = setTimeout(startTimer, propsRef.current.delay);
        } else {
          startTimer();
        }
      } else if (propsRef.current.onEnd) {
        propsRef.current.onEnd();
      }
    },
    [timer],
  );

  React.useEffect(() => {
    unmounted.current = false;

    if (queue.current.length) {
      traverseQueue(currentStateRef.current);
    }

    return () => {
      unmounted.current = true;
      if (timeoutID.current) clearTimeout(timeoutID.current);
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop(); // Is this necessary? If it's the last subscriber, unsubscribe handles it. The original code did this though.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // When data changes, continue from currently visible state to new data
    if (timeoutID.current) clearTimeout(timeoutID.current);
    if (loopID.current) timer.unsubscribe(loopID.current);

    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue(currentStateRef.current);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
