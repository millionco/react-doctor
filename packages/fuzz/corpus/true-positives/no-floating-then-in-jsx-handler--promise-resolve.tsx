// rule: no-floating-then-in-jsx-handler
// source: PR #1000 corpus sweep
import { useRef } from "react";

export const Trigger = () => {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      onMouseLeave={() => {
        Promise.resolve().then(() => {
          if (ref.current) ref.current.dataset.suppress = "false";
        });
      }}
    >
      hover
    </button>
  );
};
