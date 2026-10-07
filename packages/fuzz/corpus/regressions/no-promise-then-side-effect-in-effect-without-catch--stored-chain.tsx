// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: alias-guard
// source: full-suite regression after rejection-handler hardening
// verdict: pass

import { useEffect, useState } from "react";

export const DetailLoader = () => {
  const [detail, setDetail] = useState<unknown>(null);

  useEffect(() => {
    const request = fetch("/detail").then((response) => {
      setDetail(response);
    });
    const observedRequest = request;
    observedRequest.catch(() => {
      setDetail(null);
    });
  }, []);

  return <>{String(detail)}</>;
};
