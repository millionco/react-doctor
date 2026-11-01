// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic
// verdict: fail

import { useCallback, useEffect, useState } from "react";
interface FocusInput {
  query: string;
  readValue: (query: string) => Promise<string>;
}
export const FocusResult = ({ query, readValue }: FocusInput) => {
  const [value, setValue] = useState("");
  const run = useCallback(async () => {
    const received = await readValue(query);
    if (!received) setValue("empty");
  }, [query, readValue]);
  useEffect(() => {
    if (document.hasFocus()) run();
  }, [query, run]);
  return <output>{value}</output>;
};
