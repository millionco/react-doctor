// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: RDE verekia/r3f-gamedev damage-numbers.tsx
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";

export const DamageNumbers = () => {
  const timerRef = useRef(0);
  const [damages, setDamages] = useState<number[]>([]);

  useFrame((_, delta) => {
    timerRef.current += delta;
    if (timerRef.current > 0.3) {
      timerRef.current = 0;
      setDamages((currentDamages) => [...currentDamages, Math.random()]);
    }
  });

  return <group userData={{ damages }} />;
};
