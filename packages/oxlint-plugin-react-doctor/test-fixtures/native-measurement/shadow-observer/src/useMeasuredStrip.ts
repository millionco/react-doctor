import { ResizeObserver } from "src/alternateObserver";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import defer from "src/defer";

export function useMeasuredStrip({ index }: { index: number }) {
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [offset, setOffset] = useState(0);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const start = useCallback((element: RefObject<HTMLElement | null>) => {
    if (!element?.current) return;
    observer.current = new ResizeObserver(
      defer((entries: ResizeObserverEntry[]) => {
        if (!entries) return;
        entries.forEach((entry) => {
          setWidth(entry.contentRect.width);
          setHeight(entry.contentRect.height);
        });
      }, 20),
    );
    observer.current.observe(element.current);
  }, []);
  const stop = useCallback(() => {
    if (observer.current && wrapper.current) {
      observer.current.unobserve(wrapper.current);
      observer.current = null;
    }
  }, []);
  useEffect(() => {
    if (!wrapper.current) return;
    const rectangle = wrapper.current.getBoundingClientRect();
    setWidth(rectangle.width);
    setHeight(rectangle.height);
  }, []);
  const previous = useRef({ width: 0, height: 0 });
  useEffect(() => {
    if (width === 0 && height === 0) return;
    const changed = previous.current.width !== width || previous.current.height !== height;
    if (!changed) return;
    previous.current = { width, height };
    if (!content.current) return;
    if (content.current.scrollWidth <= width) {
      setOffset(0); // TARGET_MEASURED_RESET
      return;
    }
    setOffset(-index * (content.current.scrollWidth - width));
  }, [width, height, index]);
  return { width, height, offset, wrapper, content, start, stop };
}
