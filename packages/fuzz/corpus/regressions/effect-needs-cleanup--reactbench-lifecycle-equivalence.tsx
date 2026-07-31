// verdict: pass
// rule: effect-needs-cleanup
// weakness: stable capture aliases, replayed target loops, and callback-ref replacement
// source: react-bench job d8321254-7c6a-44d0-8feb-a55a682eeb80
import { useCallback, useEffect, useRef } from "react";

export const LifecycleEquivalence = ({ first, second, onWheel }) => {
  const nodeRef = useRef<HTMLElement | null>(null);
  const setNode = useCallback(
    (node: HTMLElement | null) => {
      const previous = nodeRef.current;
      if (previous && previous !== node) {
        previous.removeEventListener("wheel", onWheel);
      }
      nodeRef.current = node;
      if (node) node.addEventListener("wheel", onWheel, { passive: false });
    },
    [onWheel],
  );

  useEffect(() => {
    const targets = [first, second];
    const options = { passive: false };
    for (const target of targets) target.addEventListener("wheel", onWheel, options);
    return () => {
      for (const target of targets) target.removeEventListener("wheel", onWheel);
    };
  }, [first, onWheel, second]);

  return <button ref={setNode} />;
};
