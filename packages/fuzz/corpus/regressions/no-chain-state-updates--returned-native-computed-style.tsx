// rule: no-chain-state-updates
// verdict: pass
// weakness: provenance
// source: Invented native computed-style API classification control

import { useEffect, useRef, useState } from "react";
const readShade = (element) => getComputedStyle(element).opacity;
export const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  useEffect(() => {
    if (surfaceRef.current) setShade(readShade(surfaceRef.current));
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
