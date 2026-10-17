// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: alias-guard
// source: synthetic namespace provider binding
function require() {
  return { useRef: customRef };
}
namespace require {
  export interface Marker {}
}
require("react").useRef = customRef;
// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: control-flow
// source: synthetic closed native ref generation snapshot regression
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
