// rule: prefer-module-scope-static-value
// weakness: name-heuristic
// verdict: pass
import { useRef } from "react";

export const ReadingPane = () => {
  const slots = { body: useRef<HTMLDivElement>(null) };
  return <div ref={slots.body} />;
};
