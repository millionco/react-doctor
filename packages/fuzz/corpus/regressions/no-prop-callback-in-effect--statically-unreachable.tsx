// rule: no-prop-callback-in-effect
// verdict: pass
// weakness: control-flow
// source: synthetic callback inside an unreachable condition

import { useEffect, useState } from "react";
export function Panel({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    // oxlint-disable-next-line no-constant-condition -- The unreachable branch is the regression input.
    if (false) onChange(value);
  }, [value, onChange]);
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
}
