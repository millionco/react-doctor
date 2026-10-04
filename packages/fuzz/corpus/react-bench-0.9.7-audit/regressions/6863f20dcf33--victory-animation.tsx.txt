// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6863f20dcf33d82f795462b5da26d1d9473b3ba85b819de7aef929b9448de129
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
  const timeoutId = React.useRef<any>(undefined);

  // Keep refs for latest props so callbacks access the newest values
  const propsRef = React.useRef({ duration, easing, delay, onEnd });
  propsRef.current = { duration, easing, delay, onEnd };

  // Track the most recent style rendered, to continue animations smoothly
  // We update this manually before setState so it's immune to React batching delays.
  const stateDataRef = React.useRef(state.data);

  const traverseQueue = React.useCallback(() => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the current visible style towards the next target
      interpolator.current = victoryInterpolator(stateDataRef.current, nextData);

      if (propsRef.current.delay) {
        timeoutId.current = setTimeout(() => {
          loopID.current = timer.subscribe(
            functionToBeRunEachFrame,
            propsRef.current.duration,
          );
        }, propsRef.current.delay);
      } else {
        loopID.current = timer.subscribe(
          functionToBeRunEachFrame,
          propsRef.current.duration,
        );
      }
    } else if (propsRef.current.onEnd) {
      propsRef.current.onEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (timeoutId.current !== undefined) {
        clearTimeout(timeoutId.current);
      }
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstUpdate = React.useRef(true);
  React.useEffect(() => {
    if (isFirstUpdate.current) {
      isFirstUpdate.current = false;
      return;
    }

    // Cancel existing loop and timeout if they exist
    if (timeoutId.current !== undefined) {
      clearTimeout(timeoutId.current);
      timeoutId.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const functionToBeRunEachFrame = React.useCallback(
    (elapsed: number) => {
      if (!interpolator.current) return;
      const { duration: latestDuration, easing: latestEasing } = propsRef.current;

      // Step can generate imprecise values, sometimes greater than 1
      // if this happens set the state to 1 and return, cancelling the timer
      const step = latestDuration ? elapsed / latestDuration : 1;

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
        traverseQueue();
        return;
      }

      // If we're not at the end of the timer, set the state by passing
      // current step value that's transformed by the ease function to the
      // interpolator, which is cached for performance whenever props are received
      const ease = d3Ease[formatAnimationName(latestEasing!)];
      const nextData = interpolator.current(ease(step));
      stateDataRef.current = nextData;

      setState({
        data: nextData,
        animationInfo: {
          progress: step,
          animating: step < 1,
        },
      });
    },
    [timer, traverseQueue],
  );

  return children(state.data, state.animationInfo);
};
