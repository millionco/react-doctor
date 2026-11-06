// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: PR #2317 independent review
// verdict: pass
import { useEffect, useState } from "react";

interface Props {
  id: string;
}

const consume = (_value) => undefined;
const assign = (callback, value) => callback(value);

export const BoundCallback = ({ id }: Props) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const bound = assign.bind(null, consume);
    queueMicrotask(() => {
      assign.bind(null, consume)(setValue, id);
      bound(setValue, id);
      assign.call(setValue, consume, id);
      assign.apply(setValue, [consume, id]);
    });
  }, [id]);
  return <output>{value}</output>;
};
