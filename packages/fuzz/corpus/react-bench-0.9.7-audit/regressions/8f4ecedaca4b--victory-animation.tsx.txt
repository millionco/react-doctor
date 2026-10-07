// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 8f4ecedaca4b58f8755ae3bcfbdbb5e836ec339e3efed4c30bc93f980b354f6e
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

type AnimationInterpolator = (value: number) => AnimationStyle;

interface AnimationStep {
  generation: number;
  interpolator: AnimationInterpolator;
}

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
  const timerRef = React.useRef(timer);
  timerRef.current = timer;

  const queue = React.useRef<AnimationStyle[]>(
    Array.isArray(data) ? data.slice(1) : [data],
  );
  const visibleData = React.useRef(initialData);
  const currentStep = React.useRef<AnimationStep | undefined>(undefined);
  const loopID = React.useRef<number | undefined>(undefined);
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = React.useRef(0);
  const mounted = React.useRef(false);
  const previousData = React.useRef<AnimationData>(data);
  const requestedData = React.useRef<AnimationData>(data);
  const activeData = React.useRef<AnimationData>(data);

  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  const ease = d3Ease[formatAnimationName(easing)];
  const easeRef = React.useRef(ease);
  easeRef.current = ease;

  requestedData.current = data;

  const cancelActiveAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }

    if (loopID.current !== undefined) {
      timerRef.current.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    currentStep.current = undefined;
  };

  const isCurrentStep = (step: AnimationStep) => {
    return (
      mounted.current &&
      currentStep.current === step &&
      generation.current === step.generation &&
      activeData.current === requestedData.current
    );
  };

  const traverseQueue = (queueGeneration: number) => {
    if (!mounted.current || generation.current !== queueGeneration) {
      return;
    }

    if (!queue.current.length) {
      onEndRef.current?.();
      return;
    }

    const nextData = queue.current[0];
    const step: AnimationStep = {
      generation: queueGeneration,
      interpolator: victoryInterpolator(visibleData.current, nextData),
    };
    currentStep.current = step;

    const subscribe = () => {
      if (!isCurrentStep(step)) {
        return;
      }
      delayID.current = undefined;

      const subscriptionID = timerRef.current.subscribe((elapsed) => {
        if (activeData.current !== requestedData.current) {
          cancelActiveAnimation();
          generation.current += 1;
          return;
        }

        if (!isCurrentStep(step)) {
          return;
        }

        const stepProgress = durationRef.current
          ? elapsed / durationRef.current
          : 1;

        if (stepProgress >= 1) {
          const finalData = step.interpolator(1);
          visibleData.current = finalData;
          setState({
            data: finalData,
            animationInfo: {
              progress: 1,
              animating: false,
              terminating: true,
            },
          });

          if (loopID.current !== undefined) {
            timerRef.current.unsubscribe(loopID.current);
            loopID.current = undefined;
          }

          currentStep.current = undefined;
          queue.current.shift();
          traverseQueue(queueGeneration);
          return;
        }

        const nextData = step.interpolator(easeRef.current(stepProgress));
        visibleData.current = nextData;
        setState({
          data: nextData,
          animationInfo: {
            progress: stepProgress,
            animating: stepProgress < 1,
          },
        });
      }, durationRef.current);

      if (isCurrentStep(step)) {
        loopID.current = subscriptionID;
      } else {
        timerRef.current.unsubscribe(subscriptionID);
      }
    };

    if (delayRef.current) {
      delayID.current = setTimeout(subscribe, delayRef.current);
    } else {
      subscribe();
    }
  };

  const startQueue = (nextQueue: AnimationStyle[], nextData: AnimationData) => {
    cancelActiveAnimation();
    generation.current += 1;
    activeData.current = nextData;
    queue.current = nextQueue;
    traverseQueue(generation.current);
  };

  React.useEffect(() => {
    mounted.current = true;
    if (queue.current.length) {
      traverseQueue(generation.current);
    }

    return () => {
      mounted.current = false;
      generation.current += 1;
      cancelActiveAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (previousData.current !== data) {
      previousData.current = data;
      startQueue(Array.isArray(data) ? data.slice() : [data], data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
