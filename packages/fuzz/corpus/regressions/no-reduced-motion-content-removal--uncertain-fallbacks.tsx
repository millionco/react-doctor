// rule: no-reduced-motion-content-removal
// weakness: cross-file
// source: adversarial audit of deterministic design rules
// verdict: pass

import { useReducedMotion } from "motion/react";

export const ReducedContent = ({ fallback }) => {
  const reduced = useReducedMotion();
  const unused = reduced ? null : <p>Unused</p>;
  return (
    <div>
      <p className="hidden motion-reduce:hidden">Already hidden</p>
      <p className="motion-reduce:hidden">Saved</p>
      <ReducedMotionFallback />
      {fallback}
    </div>
  );
};
