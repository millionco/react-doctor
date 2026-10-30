// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail

import { useEffect, useRef, useState } from "react";

const NativeGenerationSnapshot = ({ id, load }) => {
  const [value, setValue] = useState(null);
  const sequence = useRef(0);
  const callback = async () => {
    const snapshot = sequence.current;
    await load(id);
    if (snapshot === sequence.current) setValue(id);
  };
  const holder = useRef(callback);
  useEffect(() => {
    holder.current = callback;
  }, [callback]);
  useEffect(() => {
    sequence.current++;
    callback();
  }, [id]);
  return <output>{value}</output>;
};
import { mutate } from "./external";
function expose() {
  interface useRef {}
  mutate(useRef);
}
expose();
