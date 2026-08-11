// rule: effect-needs-cleanup
// file-path: src/victory-animation/victory-animation.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 0f00fa56591b637ea6f6308bb92190fb27fede2d537aedb45a9daa9e46b61064
import React from "react";
import * as d3Ease from "victory-vendor/d3-ease";
import { victoryInterpolator } from "./util";
import TimerContext from "../victory-util/timer-context";

export type AnimationStyle = { [key: string]: string | number };
export type AnimationData = AnimationStyle | AnimationStyle[];
export type AnimationEasing =
  | "back" | "backIn" | "backOut" | "backInOut" | "bounce" | "bounceIn" | "bounceOut" | "bounceInOut"
  | "circle" | "circleIn" | "circleOut" | "circleInOut" | "linear" | "linearIn" | "linearOut" | "linearInOut"
  | "cubic" | "cubicIn" | "cubicOut" | "cubicInOut" | "elastic" | "elasticIn" | "elasticOut" | "elasticInOut"
  | "exp" | "expIn" | "expOut" | "expInOut" | "poly" | "polyIn" | "polyOut" | "polyInOut"
  | "quad" | "quadIn" | "quadOut" | "quadInOut" | "sin" | "sinIn" | "sinOut" | "sinInOut";

export interface VictoryAnimationProps {
  children: (style: AnimationStyle, info: AnimationInfo) => React.ReactElement;
  duration?: number; easing?: AnimationEasing; delay?: number; onEnd?: () => void; data: AnimationData;
}
export interface VictoryAnimationState { data: AnimationStyle; animationInfo: AnimationInfo; }
export interface AnimationInfo { progress: number; animating: boolean; terminating?: boolean; }
export interface VictoryAnimation { context: React.ContextType<typeof TimerContext>; }

const formatAnimationName = (name: AnimationEasing) => `ease${name.charAt(0).toUpperCase()}${name.slice(1)}`;
const DEFAULT_DURATION = 1000;

export const VictoryAnimation = ({ duration = DEFAULT_DURATION, easing = "quadInOut", delay = 0, data, children, onEnd }: VictoryAnimationProps) => {
  const initial = Array.isArray(data) ? data[0] : data;
  const [state, setState] = React.useState<VictoryAnimationState>({ data: initial, animationInfo: { progress: 0, animating: false } });
  const timer = React.useContext(TimerContext).animationTimer;
  const visible = React.useRef(initial);
  const queue = React.useRef<AnimationStyle[]>(Array.isArray(data) ? data.slice(1) : []);
  const run = React.useRef(0);
  const subscription = React.useRef<number | undefined>();
  const timeout = React.useRef<ReturnType<typeof setTimeout>>();
  const settings = React.useRef({ duration, easing, delay, onEnd });
  settings.current = { duration, easing, delay, onEnd };
  const previousData = React.useRef<AnimationData>(data);
  const hadAnimation = React.useRef(false);

  const cancel = React.useCallback(() => {
    run.current += 1;
    if (subscription.current !== undefined) { timer.unsubscribe(subscription.current); subscription.current = undefined; }
    if (timeout.current !== undefined) { clearTimeout(timeout.current); timeout.current = undefined; }
  }, [timer]);

  const start = React.useCallback((targets: AnimationStyle[], id: number) => {
    if (!targets.length) {
      if (hadAnimation.current) {
        hadAnimation.current = false;
        settings.current.onEnd?.();
      }
      return;
    }
    const target = targets[0];
    const interpolate = victoryInterpolator(visible.current, target);
    const begin = (elapsed: number) => {
      if (id !== run.current) return;
      const { duration: currentDuration, easing: currentEasing } = settings.current;
      const step = currentDuration ? elapsed / currentDuration : 1;
      if (step >= 1) {
        visible.current = interpolate(1);
        setState({ data: visible.current, animationInfo: { progress: 1, animating: false, terminating: true } });
        if (subscription.current !== undefined) timer.unsubscribe(subscription.current);
        subscription.current = undefined;
        queue.current.shift();
        start(queue.current, id);
        return;
      }
      const ease = d3Ease[formatAnimationName(currentEasing)];
      visible.current = interpolate(ease(step));
      setState({ data: visible.current, animationInfo: { progress: step, animating: true } });
    };
    const subscribe = () => {
      if (id === run.current) {
        hadAnimation.current = true;
        subscription.current = timer.subscribe(begin, settings.current.duration);
      }
    };
    if (settings.current.delay) timeout.current = setTimeout(subscribe, settings.current.delay); else subscribe();
  }, [timer]);

  React.useEffect(() => {
    const changed = previousData.current !== data;
    previousData.current = data;
    cancel();
    const id = run.current;
    if (changed) queue.current = Array.isArray(data) ? data.slice() : [data];
    start(queue.current, id);
    return cancel;
  }, [data, duration, easing, delay, onEnd, cancel, start]);

  return children(state.data, state.animationInfo);
};
