// rule: no-reset-all-state-on-prop-change
// weakness: provider-identity
// source: independent synthetic runtime binding regression
// verdict: pass
const require = (_source: string) => ({ useState: () => [0, () => {}] });
interface require {}
require("react").useState = () => [0, () => {}];
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
