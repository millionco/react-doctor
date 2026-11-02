// rule: no-chain-state-updates
// verdict: fail
// weakness: provenance
// source: Invented native computed-style API classification control

import { useEffect, useRef, useState } from "react";
getComputedStyle = customReader;
export const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  useEffect(() => {
    if (surfaceRef.current) setShade(getComputedStyle(surfaceRef.current).opacity);
  }, [step]);
  return (
    <section ref={surfaceRef}>
      <button onClick={() => setStep((previous) => previous + 1)}>
        {shade}
        {step}
      </button>
    </section>
  );
};
