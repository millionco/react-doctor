// rule: no-focus-in-animation-completion-handler
// weakness: stale-binding-provenance
// source: adversarial audit of deterministic design rules
// verdict: pass

import { useRef } from "react";

export const CompletionFocus = () => {
  let reassignedRef = useRef(null);
  const plainRef = useRef(null);
  reassignedRef = { current: editor };
  return (
    <>
      <div ref={plainRef} />
      <div onAnimationEnd={() => searchIndex.focus()} />
      <div
        onTransitionEnd={() => {
          if (false) plainRef.current.focus();
        }}
      />
      <div onAnimationEnd={() => reassignedRef.current.focus()} />
    </>
  );
};
