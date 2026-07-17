// rules: no-chain-state-updates, no-derived-state, no-derived-state-effect, no-effect-chain
// weakness: textual effect-setter-dependency identity
// source: ASAP_FIX.md mutation replay

import * as React from "react";

const runEffect = React.useEffect;

export const AliasedEffectChain = ({ source }: { source: number }) => {
  const [step, setStep] = (React as any).useState(0);
  const [ready, setReady] = React!.useState(false);
  const writeStep = setStep;
  const writeReady = setReady;
  const currentStep = step;
  runEffect(() => writeStep(1), [source, writeStep]);
  runEffect(() => {
    if (currentStep > 0) writeReady(true);
  }, [currentStep, writeReady]);
  return ready;
};
