// verdict: pass
// rule: no-impure-state-updater
// weakness: wrapper-transparency
// source: GitHub issue #1812
import { useCallback, useState } from "react";

export function Repro() {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  }, []);
  const first = () =>
    run(async () => {
      await Promise.resolve();
      setValue("first");
    });
  const second = () =>
    run(async () => {
      await Promise.resolve();
      setValue("second");
    });
  return (
    <button type="button" disabled={busy} onClick={value ? second : first}>
      {value || "Run"}
    </button>
  );
}
