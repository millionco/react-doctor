// rule: no-direct-state-mutation
// weakness: library-idiom
// source: adversarial edge-case hunt (callback-ref DOM node written to imperatively)
import { useEffect, useState } from "react";

export const CallbackRefCounter = () => {
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!node) return;
    node.dataset.mounted = "true";
  }, [node]);
  return <span ref={setNode}>ready</span>;
};
