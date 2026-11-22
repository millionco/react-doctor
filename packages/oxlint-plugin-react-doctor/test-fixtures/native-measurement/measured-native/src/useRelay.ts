import { useCallback, useRef } from "react";
export function useRelay({ delta = 0, onSwiping, onSwiped }: any) {
  const sample = useRef({ swiping: false, startX: 0, startY: 0, samples: [] });
  const config = useRef({ delta, onSwiping, onSwiped });
  config.current = { delta, onSwiping, onSwiped };
  const listeners = useRef<any>(null);
  if (!listeners.current) {
    const begin = (event: TouchEvent) => {
      const state = sample.current;
      state.swiping = false;
      state.startX = 0;
      state.startY = 0;
      state.samples = [];
    };
    const move = (event: TouchEvent) => {
      const { delta: distance, onSwiping: cb } = config.current;
      if (cb) cb({ event, absX: 1, absY: 2, dir: "Left", velocity: 0 });
    };
    const finish = (event: TouchEvent) => {
      const { onSwiped: cb } = config.current;
      if (cb) cb({ event, absX: 1, absY: 2, dir: "Right", velocity: 0 });
    };
    listeners.current = { touchstart: begin, touchmove: move, touchend: finish };
  }
  const node = useRef<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    const handlers = listeners.current;
    if (node.current) {
      node.current.removeEventListener("touchstart", handlers.touchstart);
      node.current.removeEventListener("touchmove", handlers.touchmove);
      node.current.removeEventListener("touchend", handlers.touchend);
    }
    node.current = element;
    if (element) {
      element.addEventListener("touchstart", handlers.touchstart, { passive: true });
      element.addEventListener("touchmove", handlers.touchmove, { passive: false });
      element.addEventListener("touchend", handlers.touchend, { passive: true });
    }
  }, []);
  return { ref };
}
