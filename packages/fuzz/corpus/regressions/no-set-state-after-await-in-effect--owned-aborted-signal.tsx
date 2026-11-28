// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: control-flow
// source: synthetic effect reads its owned signal before the setter

import { useEffect, useState } from "react";
export function Panel({ id, load }: { id: string; load: (key: string) => Promise<string> }) {
  const [, setValue] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const value = await load(id);
      if (controller.signal.aborted) return;
      setValue(value);
    };
    run();
    return () => controller.abort();
  }, [id, load]);
  return null;
}
