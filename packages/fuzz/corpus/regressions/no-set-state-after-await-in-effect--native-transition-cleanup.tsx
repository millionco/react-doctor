// rule: no-set-state-after-await-in-effect
// weakness: library-idiom
// source: independent synthetic regression
// verdict: pass

import { useEffect, useState, useTransition } from "react";
export const Example = ({ value }) => {
  const [text, writeText] = useState("");
  const [pending, begin] = useTransition();
  useEffect(() => {
    let cancelled = false;
    begin(async () => {
      await Promise.resolve(value);
      if (cancelled) return;
      writeText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return <output>{pending ? "waiting" : text}</output>;
};
