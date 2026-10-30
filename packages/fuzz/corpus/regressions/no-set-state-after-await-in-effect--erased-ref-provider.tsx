// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: control-flow
// source: synthetic erased TypeScript React loader binding
import { useEffect, useRef, useState } from "react";
declare const require: any;
require("react").useRef = customRef;

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
