// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: nested-function
import { useEffect, useState } from "react";

export const DeferredEffect = () => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    fetch("/value").then((value) => () => setValue(String(value)));
  }, []);
  return null;
};
