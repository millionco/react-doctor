// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: copy-tracking
// source: adversarial review 2026-07
// verdict: fail

import { useEffect, useState } from "react";

interface AssignedRequestProps {
  readonly shouldObserve: boolean;
}

export const AssignedRequest = ({ shouldObserve }: AssignedRequestProps) => {
  const [, setValue] = useState<Response>();

  useEffect(() => {
    let request;
    request = fetch("/value").then((value) => setValue(value));
    if (shouldObserve) request.catch(() => setValue(undefined));
  }, [shouldObserve]);

  return null;
};
