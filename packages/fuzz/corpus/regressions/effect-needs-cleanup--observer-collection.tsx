// rule: effect-needs-cleanup
// weakness: retained-observer-collection-cleanup
// source: react-bench write-react-cloudscape-design-components dCFuz44

import { useLayoutEffect, useState } from "react";

export const VisualContext = ({ element }: { element: HTMLElement | null }) => {
  const [value, setValue] = useState("");

  useLayoutEffect(() => {
    if (!element) return;
    const detect = () => setValue(element.className);
    const observers: MutationObserver[] = [];

    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const observer = new MutationObserver(detect);
      observer.observe(node, { attributes: true, attributeFilter: ["class"] });
      observers.push(observer);
    }

    return () => observers.forEach((observer) => observer.disconnect());
  }, [element]);

  return <output>{value}</output>;
};
