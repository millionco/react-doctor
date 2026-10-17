// verdict: pass
// rule: no-reset-all-state-on-prop-change
// weakness: binding-identity
// source: independent synthetic partial-state reset
import { useEffect, useState } from "react";
export const Example = ({ itemKey }: { itemKey: string }) => {
  const [notice, writeNotice] = useState("");
  const [, writeBusy] = useState(false);

  useEffect(() => {
    writeNotice("");
  }, [itemKey]);
  return (
    <section>
      <button onClick={() => writeBusy(true)}>Busy</button>
      <output>{notice}</output>
    </section>
  );
};
