// rule: no-set-state-after-await-in-effect
// weakness: erased-binding-identity
// source: synthetic
// verdict: fail
import { useCallback, useEffect, useState } from "react";
export const FocusPanel = ({
  query,
  readValue,
}: {
  query: string;
  readValue: (value: string) => Promise<string>;
}) => {
  const [value, setValue] = useState("");
  const run = useCallback(async () => {
    interface readValue {}
    const received = await readValue(query);
    if (!received) setValue("empty");
  }, [query, readValue]);
  useEffect(() => {
    if (document.hasFocus()) run();
  }, [query, run]);
  return <output>{value}</output>;
};
