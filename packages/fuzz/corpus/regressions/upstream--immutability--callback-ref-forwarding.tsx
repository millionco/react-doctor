// rule: react-hooks/immutability
// weakness: library-idiom
// source: facebook/react#34955 (forwarded ref .current assignment in callback ref)
import { useCallback, useState } from "react";
import type { MutableRefObject, RefCallback } from "react";

type ForwardedRef = RefCallback<HTMLDivElement> | MutableRefObject<HTMLDivElement | null> | null;

export const useContainerWidth = (ref: ForwardedRef) => {
  const [containerWidth, setContainerWidth] = useState(0);

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
      setContainerWidth(node?.offsetWidth ?? 0);
    },
    [ref],
  );

  return { containerRef, containerWidth };
};
