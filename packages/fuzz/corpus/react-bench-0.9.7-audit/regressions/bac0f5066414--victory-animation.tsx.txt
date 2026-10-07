// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit bac0f506641445be35912cbdbf0b3e9d065672f2f93978baa3e35fc08fc6823e
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

  // Refs for latest props and runtime state
  const durationRef = React.useRef(duration);
  const easingRef = React.useRef(easing);
  const delayRef = React.useRef(delay);
  const onEndRef = React.useRef(onEnd);
  const dataPropRef = React.useRef(data);

  const queue = React.useRef<AnimationStyle[]>([]);
  const interpolator = React.useRef<null | ((value: number) => AnimationStyle)>(null);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateDataRef = React.useRef<AnimationStyle>(state.data);
  const runIdRef = React.useRef(0);
  const activeRunIdRef = React.useRef(0);
  const mountedRef = React.useRef(false);

  // Keep refs synchronized with latest props on every render
  React.useEffect(() => {
    durationRef.current = duration;
    easingRef.current = easing;
    delayRef.current = delay;
    onEndRef.current = onEnd;
    dataPropRef.current = data;
    stateDataRef.current = state.data;
  });

  const traverseQueue = () => {
    if (queue.current.length === 0) {
      if (onEndRef.current) {
        onEndRef.current();
      }
      return;
    }

    const target = queue.current[0];
    const start = stateDataRef.current;
    interpolator.current = victoryInterpolator(start, target);

    const currentId = ++runIdRef.current;
    activeRunIdRef.current = currentId;

    const startTimer = () => {
      const subId = timer.subscribe((elapsed: number) => {
        if (activeRunIdRef.current !== currentId) return;
        if (!interpolator.current) return;

        const d = durationRef.current;
        const step = d ? elapsed / d : 1;

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
          stateDataRef.current = finalData;

          if (loopID.current === subId) {
            timer.unsubscribe(subId);
            loopID.current = undefined;
          }

          queue.current.shift();
          if (queue.current.length) {
            traverseQueue();
          } else {
            if (onEndRef.current) {
              onEndRef.current();
            }
          }
          return;
        }

        const easeFunc = d3Ease[formatAnimationName(easingRef.current as AnimationEasing)];
        const easedStep = easeFunc ? easeFunc(step) : step;
        const newData = interpolator.current(easedStep);
        setState({
          data: newData,
          animationInfo: {
            progress: step,
            animating: true,
          },
        });
        stateDataRef.current = newData;
      }, durationRef.current);

      loopID.current = subId;
    };

    if (delayRef.current) {
      delayTimeout.current = setTimeout(startTimer, delayRef.current);
    } else {
      startTimer();
    }
  };

  // Mount: initialize queue and start first queued step if any
  React.useEffect(() => {
    mountedRef.current = true;
    queue.current = Array.isArray(data) ? data.slice(1) : [];
    stateDataRef.current = state.data;
    if (queue.current.length) {
      traverseQueue();
    }
    return () => {
      if (loopID.current !== undefined && loopID.current !== null) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
        delayTimeout.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle data prop changes: supersede previous run and start fresh from visible style
  React.useEffect(() => {
    if (!mountedRef.current) return;
    // Cancel any active timer or delayed start
    if (loopID.current !== undefined && loopID.current !== null) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = null;
    }

    // Build new queue: if array, first element is the immediate target
    queue.current = Array.isArray(data) ? [...data] : [data];
    stateDataRef.current = state.data;

    traverseQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
