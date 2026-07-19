// rule: no-chain-state-updates
// weakness: alias-guard
// source: PR #1358 review

import { useEffect, useState } from "react";

export const SetterHelperFactory = ({ source }: { source: string }) => {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const bind = (setter: (value: boolean) => void) => (value: boolean) => setter(value);
  const run = bind(setReady);
  const onChange = () => setStep((value) => value + 1);

  useEffect(() => run(true), [step, source, run]);

  return <button onClick={onChange}>{String(ready)}</button>;
};
