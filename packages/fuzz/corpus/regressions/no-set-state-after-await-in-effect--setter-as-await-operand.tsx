// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: control-flow
// source: synthetic effect setter called while evaluating an await operand

import { useEffect, useState } from "react";

export function Widget({ query }: { query: string }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const update = async () => {
      await setValue(query);
    };
    update();
  }, [query]);
  return <span>{value}</span>;
}
