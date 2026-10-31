// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: wrapper-transparency
// source: synthetic immediate invocation regression
// verdict: fail

import { useEffect, useState } from "react";

export const RemoteValue = () => {
  const [value, setValue] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      fetch("/value")
        .then((response) => response.json())
        .then(setValue);
    })().catch(() => {});
  }, []);

  return <output>{String(value)}</output>;
};
