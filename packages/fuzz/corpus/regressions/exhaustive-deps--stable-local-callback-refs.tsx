import { useCallback, type DependencyList } from "react";

type ButtonRef = ((node: HTMLButtonElement | null) => void) & { current: HTMLButtonElement | null };

function useTrackedButton(setNode: (node: HTMLButtonElement | null) => void, deps: DependencyList) {
  const ref = useCallback((node: HTMLButtonElement | null) => {
    ref.current = node;
    setNode(node);
  }, deps) as ButtonRef;
  return ref;
}

export function MeasureButton({ onMeasure }: { onMeasure: (height: number) => void }) {
  const measure = useCallback(() => button.current?.clientHeight ?? 0, []);
  const button = useTrackedButton(() => undefined, []);
  return (
    <button type="button" ref={button} onClick={() => onMeasure(measure())}>
      Measure button
    </button>
  );
}
