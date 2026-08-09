// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 6fb67da7704c83b66b5b2b7419813139340fefe4036a3331402f55bbcf292954
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
  const delayId = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const latestProps = React.useRef({ duration, easing, onEnd });
  latestProps.current = { duration, easing, onEnd };

  const latestState = React.useRef(state);
  latestState.current = state;

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue();
    }

    // Clean up the animation loop
    return () => {
      if (delayId.current) clearTimeout(delayId.current);
      if (loopID.current !== undefined) timer.unsubscribe(loopID.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (delayId.current) {
      clearTimeout(delayId.current);
      delayId.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    queue.current = Array.isArray(data) ? data : [data];
    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const traverseQueue = () => {
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Compare cached version to next props
      interpolator.current = victoryInterpolator(latestState.current.data, nextData);

      // Reset step to zero
      if (delay) {
        delayId.current = setTimeout(() => {
          delayId.current = undefined;
          loopID.current = timer.subscribe(functionToBeRunEachFrame, latestProps.current.duration);
        }, delay);
      } else {
        loopID.current = timer.subscribe(functionToBeRunEachFrame, latestProps.current.duration);
      }
    } else if (latestProps.current.onEnd) {
      latestProps.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (elapsed: number) => {
    if (!interpolator.current) return;

    const { duration, easing } = latestProps.current;
    const ease = d3Ease[formatAnimationName(easing)];

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = duration ? elapsed / duration : 1;

    if (step >= 1) {
      setState({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
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
    setState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  return children(state.data, state.animationInfo);
};
