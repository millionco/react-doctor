// rule: no-adjust-state-on-prop-change
// weakness: contract-inversion
// source: published React Doctor rule contract

import { useEffect, useState } from "react";

export const MirroredValue = ({ value }: { value: string }) => {
  const [mirror, setMirror] = useState(value);

  useEffect(() => {
    setMirror(value);
  }, [value]);

  return <div>{mirror}</div>;
};
