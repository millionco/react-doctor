// rule: no-adjust-state-on-prop-change
// weakness: forwarded-setter
// source: transparent setter helper bypass of an editable reset
// verdict: fail
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface Props {
  recordId: string;
}

export const Editor = ({ recordId }: Props) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    assign(setValue, "");
  }, [recordId]);
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
};
