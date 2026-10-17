// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: independent synthetic merged runtime binding regression
// verdict: pass
import { useEffect, useState } from "react";
interface ExampleProps {
  enabled: boolean;
}
export const Example = ({ enabled }: ExampleProps) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const payload = await Promise.resolve({ count: 1 });

      interface cancelled {}
      if (!cancelled && payload && typeof payload === "object") {
        setValue(payload);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return <output>{String(value)}</output>;
};
