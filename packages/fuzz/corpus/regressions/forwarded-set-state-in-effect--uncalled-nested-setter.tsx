// rule: forwarded-set-state-in-effect
// weakness: wrapper-transparency
// source: an uncalled returned setter callback must not hide a synchronous forwarded write
// verdict: fail
import { useEffect, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

interface EditorProps {
  id: string;
}

export const Editor = ({ id }: EditorProps) => {
  const [value, setValue] = useState("");
  const [other, setOther] = useState("");
  useEffect(() => {
    const makeHandler = () => () => setOther(id);
    makeHandler();
    assign(setValue, id);
  }, [id]);
  return (
    <div>
      {value}
      {other}
    </div>
  );
};
