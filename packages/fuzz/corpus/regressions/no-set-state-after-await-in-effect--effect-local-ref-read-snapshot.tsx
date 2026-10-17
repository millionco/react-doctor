// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: control-flow
// source: synthetic effect-local closed native ref generation snapshot
import { useEffect, useRef, useState } from "react";

const LocalGenerationSnapshot = ({ id, load }) => {
  const [value, setValue] = useState(null);
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current++;
    const callback = async () => {
      const snapshot = sequence.current;
      await load(id);
      if (snapshot === sequence.current) setValue(id);
    };
    callback();
  }, [id]);
  return <output>{value}</output>;
};
