// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: alias-guard
// source: adversarial review 2026-07
// verdict: pass

import { useEffect, useState } from "react";

export const HandledAssignedRequest = () => {
  const [, setValue] = useState<Response>();

  useEffect(() => {
    let request;
    request = fetch("/value").then((value) => setValue(value));
    request.catch(() => setValue(undefined));
  }, []);

  return null;
};
