// rule: loading-action-preserves-trigger
// weakness: control-flow
// source: adversarial audit of deterministic design rules
// verdict: pass

import { useState } from "react";

export const Save = () => {
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    setPending(false);
    await fetch("/api/save");
    router.navigate("/done");
  };
  return pending ? (
    <retry-button />
  ) : (
    <button type="submit" form="target" onClick={save}>
      Save
    </button>
  );
};
