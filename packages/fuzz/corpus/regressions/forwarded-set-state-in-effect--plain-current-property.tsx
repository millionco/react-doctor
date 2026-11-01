// rule: forwarded-set-state-in-effect
// weakness: name-heuristic
// source: an ordinary current property is not React ref provenance
// verdict: fail
import { useEffect, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

interface EditorProps {
  id: string;
}

export const Editor = ({ id }: EditorProps) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    const plain = { current: id };
    if (plain.current) assign(setValue, id);
  }, [id]);
  return <div>{value}</div>;
};
