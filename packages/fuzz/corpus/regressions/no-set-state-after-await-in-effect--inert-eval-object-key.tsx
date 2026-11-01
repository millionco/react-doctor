// rule: no-set-state-after-await-in-effect
// weakness: name-heuristic
// source: independent synthetic inert property regression
// verdict: pass
const metadata = { eval: "label" };
void metadata;
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
