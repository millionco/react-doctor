// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit d5342474529c64a71a2330386c7a61bdaf06f849fb78bd078969a84aaada2976
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
  const delayID = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The style most recently handed to `children`, so a superseding animation
  // can continue from exactly what is on screen.
  const renderedData = React.useRef<AnimationStyle>(state.data);
  // Identifies the active run. Bumped whenever the run is superseded or the
  // component unmounts so callbacks belonging to an old run bail out instead
  // of rendering or completing with outdated settings.
  const activeRunID = React.useRef(0);
  const previousData = React.useRef(data);

  // Timer and timeout callbacks outlive the render they were created in, so
  // they read the latest animation settings from a ref instead of closing
  // over that render's props.
  const settings = React.useRef({ duration, easing, delay, onEnd });
  React.useEffect(() => {
    settings.current = { duration, easing, delay, onEnd };
  });

  const applyState = (nextState: VictoryAnimationState) => {
    renderedData.current = nextState.data;
    setState(nextState);
  };

  const stopAnimation = () => {
    if (delayID.current !== undefined) {
      clearTimeout(delayID.current);
      delayID.current = undefined;
    }
    if (loopID.current !== undefined) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }
  };

  const traverseQueue = (runID: number) => {
    if (runID !== activeRunID.current) {
      return;
    }
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Animate from whatever is currently rendered toward the next target
      interpolator.current = victoryInterpolator(
        renderedData.current,
        nextData,
      );

      const begin = () => {
        loopID.current = timer.subscribe(
          (elapsed, timerDuration) =>
            functionToBeRunEachFrame(elapsed, timerDuration, runID),
          settings.current.duration,
        );
      };
      if (settings.current.delay) {
        delayID.current = setTimeout(() => {
          delayID.current = undefined;
          if (runID === activeRunID.current) {
            begin();
          }
        }, settings.current.delay);
      } else {
        begin();
      }
    } else if (settings.current.onEnd) {
      settings.current.onEnd();
    }
  };

  const functionToBeRunEachFrame = (
    elapsed: number,
    timerDuration: number | undefined,
    runID: number,
  ) => {
    if (runID !== activeRunID.current || !interpolator.current) return;

    // A timer duration of zero means animation is being bypassed; otherwise
    // honor the current duration prop so mid-run changes take effect.
    const activeDuration = timerDuration === 0 ? 0 : settings.current.duration;

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = activeDuration ? elapsed / activeDuration : 1;

    if (step >= 1) {
      applyState({
        data: interpolator.current(1),
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
      traverseQueue(runID);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(settings.current.easing)];
    applyState({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    if (previousData.current !== data) {
      // New data supersedes the active run: hand off from the currently
      // rendered style toward the new data. The superseded run must neither
      // render nor complete after this point.
      previousData.current = data;
      activeRunID.current += 1;
      stopAnimation();
      queue.current = Array.isArray(data) ? data.slice() : [data];
      traverseQueue(activeRunID.current);
    } else if (
      queue.current.length &&
      loopID.current === undefined &&
      delayID.current === undefined
    ) {
      // Initial mount with array data: animate through the queued styles.
      // The length check prevents us from triggering `onEnd` in `traverseQueue`.
      traverseQueue(activeRunID.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Clean up the animation loop on unmount so no further frame can render or
  // fire a completion.
  React.useEffect(() => {
    return () => {
      activeRunID.current += 1;
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
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

  return children(state.data, state.animationInfo);
};
