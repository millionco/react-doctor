// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 5428e6c4dbd8f0775bd8d90e5c4998fad5165eb83de48f62f0d405a93aa3fde6
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

  // Keep the latest settings in refs so a run that is already in flight adopts
  // them, rather than finishing with the values captured when it started.
  const durationRef = React.useRef(duration);
  const easeRef = React.useRef<(value: number) => number>(d3Ease.easeLinear);
  const onEndRef = React.useRef(onEnd);
  durationRef.current = duration;
  easeRef.current = d3Ease[formatAnimationName(easing)];
  onEndRef.current = onEnd;

  // The style currently on screen. A mid-run `data` change tweens from here so
  // it never has to snap to the superseded target before starting over.
  const currentStyle = React.useRef(state.data);
  // Identifies the active run. Bumping it supersedes any older run: its frame
  // callbacks and delayed starts become no-ops, so it can neither render nor
  // complete after being replaced.
  const runID = React.useRef(0);
  // A pending delayed start, tracked so it can be cancelled on handoff/unmount.
  const delayTimeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isInitialMount = React.useRef(true);

  const traverseQueue = (thisRun: number) => {
    // Bail if this run was superseded while a frame/timeout was pending.
    if (thisRun !== runID.current) {
      return;
    }
    if (queue.current.length) {
      const nextData = queue.current[0];

      // Tween from the currently visible style toward the next target.
      interpolator.current = victoryInterpolator(
        currentStyle.current,
        nextData,
      );

      const startLoop = () => {
        if (thisRun !== runID.current) {
          return;
        }
        loopID.current = timer.subscribe(
          (elapsed) => functionToBeRunEachFrame(elapsed, thisRun),
          durationRef.current,
        );
      };

      // Reset step to zero
      if (delay) {
        delayTimeout.current = setTimeout(startLoop, delay);
      } else {
        startLoop();
      }
    } else {
      interpolator.current = null;
      if (onEndRef.current) {
        onEndRef.current();
      }
    }
  };

  const functionToBeRunEachFrame = (elapsed: number, thisRun: number) => {
    // Ignore frames belonging to a run that has since been superseded.
    if (thisRun !== runID.current || !interpolator.current) {
      return;
    }

    // Step can generate imprecise values, sometimes greater than 1
    // if this happens set the state to 1 and return, cancelling the timer.
    // Read `duration` from a ref so an in-flight run adopts the latest value.
    const currentDuration = durationRef.current;
    const step = currentDuration ? elapsed / currentDuration : 1;

    if (step >= 1) {
      const finalData = interpolator.current(1);
      currentStyle.current = finalData;
      setState({
        data: finalData,
        animationInfo: {
          progress: 1,
          animating: false,
          terminating: true,
        },
      });
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      queue.current.shift();
      traverseQueue(thisRun);
      return;
    }

    // If we're not at the end of the timer, set the state by passing
    // current step value that's transformed by the ease function to the
    // interpolator, which is cached for performance whenever props are received.
    // `easing` is read from a ref so an in-flight run adopts the latest value.
    const nextData = interpolator.current(easeRef.current(step));
    currentStyle.current = nextData;
    setState({
      data: nextData,
      animationInfo: {
        progress: step,
        animating: step < 1,
      },
    });
  };

  React.useEffect(() => {
    // Length check prevents us from triggering `onEnd` in `traverseQueue`.
    if (queue.current.length) {
      traverseQueue(runID.current);
    }

    // Clean up the animation loop so a completion cannot fire after unmount.
    return () => {
      // Supersede the active run: guarded callbacks become no-ops.
      runID.current += 1;
      if (delayTimeout.current) {
        clearTimeout(delayTimeout.current);
        delayTimeout.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      } else {
        timer.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // The initial render is handled by the mount effect above.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // `data` changed: hand off to a fresh run that starts from the currently
    // visible style. Superseding the previous run first ensures it neither
    // renders nor completes later, no matter how often `data` changes.
    runID.current += 1;
    const thisRun = runID.current;
    if (delayTimeout.current) {
      clearTimeout(delayTimeout.current);
      delayTimeout.current = undefined;
    }
    if (loopID.current) {
      timer.unsubscribe(loopID.current);
      loopID.current = undefined;
    }

    // Set the tween queue to the new data
    queue.current = Array.isArray(data) ? data : [data];
    // Start traversing the tween queue
    traverseQueue(thisRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return children(state.data, state.animationInfo);
};
