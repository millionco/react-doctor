// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: provider-erasure
// source: synthetic
declare const require: any;
require("react").useTransition = () => [false, () => {}];
import { useEffect, useState, useTransition } from "react";
export const Example = ({ value }) => {
  const [text, writeText] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    startTransition(async () => {
      await Promise.resolve(value);
      writeText(value);
    });
  }, [value]);
  return <output>{pending ? "waiting" : text}</output>;
};
