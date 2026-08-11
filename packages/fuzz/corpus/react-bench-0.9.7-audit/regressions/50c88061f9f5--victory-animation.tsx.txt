// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 50c88061f9f590d7f37eeb968596a38c91b8ad1e8077fd0de9daebcc3d2b6008
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

  // Keep the latest animation settings in refs so that an animation which is
  // already in progress adopts new `duration`, `easing`, and `onEnd` values
  // instead of finishing with the settings captured when it started.
  const durationRef = React.useRef(duration);
  durationRef.current = duration;
  const easingRef = React.useRef(easing);
  easingRef.current = easing;
  const delayRef = React.useRef(delay);
  delayRef.current = delay;
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  // The currently visible style. Kept in a ref (in addition to state) so that
  // asynchronous timer callbacks and effects always read the latest rendered
  // value — this is where a superseding animation resumes from.
  const currentData = React.useRef<AnimationStyle>(state.data);

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
  // Every time new `data` supersedes an in-progress animation we bump this
  // token. Frame callbacks and delayed starts capture the token that was
  // current when they were scheduled and bail out if it no longer matches, so
  // a superseded run can neither render nor complete after being replaced.
  const activeSession = React.useRef(0);
  // Distinguishes the initial mount from subsequent `data` changes.
  const isFirstRun = React.useRef(true);

  const commit = (nextState: VictoryAnimationState) => {
    currentData.current = nextState.data;
    setState(nextState);
  };

  const functionToBeRunEachFrame = (elapsed: number, session: number) => {
    // A newer animation has superseded this one (or the component unmounted):
    // do not render or complete.
    if (session !== activeSession.current) return;
    if (!interpolator.current) return;

    const currentDuration = durationRef.current;
    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      commit({
        data: interpolator.current(1),
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      }
      queue.current.shift();
      traverseQueue(session);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received
    const ease = d3Ease[formatAnimationName(easingRef.current)];
    commit({
      data: interpolator.current(ease(step)),
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  const traverseQueue = (session: number) => {
    if (session !== activeSession.current) return;

    if (queue.current.length) {
      const nextData = queue.current[0];

      // Interpolate from the currently visible style toward the next target so
      // that a superseding animation continues smoothly without flashing the
      // target of the run it replaced.
      interpolator.current = victoryInterpolator(currentData.current, nextData);

      const subscribe = () => {
        // A change may have arrived during the delay; only start if still current.
        if (session !== activeSession.current) return;
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, session),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delayRef.current) {
        delayTimeout.current = setTimeout(subscribe, delayRef.current);
      } else {
        subscribe();
      }
    } else if (onEndRef.current) {
      // Always invoke the latest `onEnd`, even if it changed mid-run.
      onEndRef.current();
    }
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(activeSession.current);
    }

    // Clean up the animation loop
    return () => {
      // Invalidate any pending frame/delay so completion cannot fire after unmount.
      activeSession.current += 1;
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The mount effect above kicks off the initial animation; skip the first
    // run here so we don't restart it.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    // Supersede whatever is running: invalidate its callbacks and cancel loops.
    activeSession.current += 1;
    const session = activeSession.current;
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
    }

    // Set the tween queue to the new data and start traversing it from the
    // currently visible style.
    queue.current = Array.isArray(data) ? [...data] : [data];
    traverseQueue(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
