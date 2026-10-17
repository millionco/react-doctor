// verdict: pass
// rule: no-reset-all-state-on-prop-change
// weakness: binding-identity
// source: independent synthetic partial-state reset
import { useEffect, useState } from "react";
export const Example = ({ itemKey }: { itemKey: string }) => {
  const [notice, writeNotice] = useState("");
  const [, writeBusy] = useState(false);
  const [previousKey] = useState(itemKey);

  useEffect(() => {
    writeNotice("");
    writeBusy(false);
  }, [itemKey]);
  return (
    <section>
      <button onClick={() => writeNotice("changed")}>Change</button>
      <button onClick={() => writeBusy(true)}>Busy</button>
      <output>
        {notice}:{previousKey}
      </output>
    </section>
  );
};
