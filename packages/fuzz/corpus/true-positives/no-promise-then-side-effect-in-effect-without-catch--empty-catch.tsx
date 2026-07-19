// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: rejection-handler-shape
import { useEffect, useState } from "react";

export const UnsafeEffect = () => {
  const [, setValue] = useState<Response>();
  useEffect(() => {
    fetch("/value").then(setValue).catch();
  }, []);
  return null;
};
