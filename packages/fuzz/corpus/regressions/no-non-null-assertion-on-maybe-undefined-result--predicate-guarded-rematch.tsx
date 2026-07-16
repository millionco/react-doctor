// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (cloudscape visual-context: findUpUntil predicate already matched the same regex, so the re-match cannot be null)
import { useLayoutEffect, useState } from "react";
import { findUpUntil } from "./dom";

const contextMatch = /awsui-context-([\w-]+)/;

export function useVisualContext(elementRef: { current: HTMLElement | null }) {
  const [value, setValue] = useState("");
  useLayoutEffect(() => {
    if (elementRef.current) {
      const contextParent = findUpUntil(
        elementRef.current,
        (node: HTMLElement) => !!node.className.match(contextMatch),
      );
      setValue(contextParent?.className.match(contextMatch)![1] ?? "");
    }
  }, [elementRef]);
  return value;
}
