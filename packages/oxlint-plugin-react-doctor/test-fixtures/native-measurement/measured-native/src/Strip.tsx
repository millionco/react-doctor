import { useCallback, useEffect, useRef } from "react";
import { useMeasuredStrip } from "src/useMeasuredStrip";
import Rail from "src/Rail";

export default function Strip({ index }: { index: number }) {
  const { offset, wrapper, content, start, stop } = useMeasuredStrip({ index });
  const begin = useRef<typeof start | null>(null);
  begin.current = start;
  useEffect(() => {
    begin.current?.(wrapper);
    return () => stop();
  }, [wrapper, stop]);
  const onSwiping = useCallback(({ event }: { event: TouchEvent }) => {
    event.stopPropagation();
  }, []);
  const onSwiped = useCallback(({ velocity, dir }: { velocity: number; dir: string }) => {}, []);
  return (
    <section>
      <Rail
        wrapper={wrapper}
        content={content}
        offset={offset}
        onSwiping={onSwiping}
        onSwiped={onSwiped}
      />
    </section>
  );
}
