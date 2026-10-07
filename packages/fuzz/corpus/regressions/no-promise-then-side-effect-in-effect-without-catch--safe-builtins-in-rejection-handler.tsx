// rule: no-promise-then-side-effect-in-effect-without-catch
// verdict: pass
// weakness: rejection-handler-shape
// source: https://github.com/millionco/react-doctor/pull/1422

import { useEffect, useState } from "react";

export const Loader = () => {
  const [, setValue] = useState<Response | null>();
  const startedAt = performance.now();

  useEffect(() => {
    fetch("/value")
      .then(setValue)
      .catch(() => {
        console.info(Math.round(performance.now() - startedAt));
        setValue(null);
      });
  }, [startedAt]);

  return null;
};
