// rule: forwarded-set-state-in-effect
// weakness: control-flow
// source: declaring a class does not execute its instance field initializer
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

export const Example = () => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    class Pending {
      value = assign(setValue, 1);
    }
    void Pending;
  }, []);
  return <div>{value}</div>;
};
