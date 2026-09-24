// rule: effect-needs-cleanup
// verdict: fail
// Source: PR #1832 review.
// Weakness: A nullable useCallback parameter does not make its callback a React ref.
import { useCallback } from "react";
export function Component() {
  const observe = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return;
    const observer = new ResizeObserver(() => {});
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <button
      onClick={() => {
        observe(document.querySelector("div"));
      }}
    >
      Observe
    </button>
  );
}
