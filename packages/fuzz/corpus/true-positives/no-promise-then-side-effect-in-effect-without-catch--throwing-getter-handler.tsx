// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: rejection-handler-shape
// source: adversarial review 2026-07
// verdict: fail

import { useEffect, useState } from "react";

interface ThrowingSource {
  readonly throwingGetter: unknown;
}

export const ThrowingGetterHandler = ({ source }: { source: ThrowingSource }) => {
  const [, setValue] = useState<Response>();

  useEffect(() => {
    fetch("/value").then(setValue, () => console.log(source.throwingGetter));
  }, [source]);

  return null;
};
