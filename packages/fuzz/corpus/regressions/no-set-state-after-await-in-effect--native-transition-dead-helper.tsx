// rule: no-set-state-after-await-in-effect
// weakness: library-idiom
// source: independent synthetic regression
// verdict: pass

import { useEffect, useState, useTransition } from "react";
export const Example = ({ value }) => {
  const [text, writeText] = useState("");
  const [pending, begin] = useTransition();
  useEffect(() => {
    const update = () => {
      begin(async () => {
        await Promise.resolve(value);
        writeText(value);
      });
    };
    if (false) update();
  }, [value]);
  return <output>{pending ? "waiting" : text}</output>;
};
