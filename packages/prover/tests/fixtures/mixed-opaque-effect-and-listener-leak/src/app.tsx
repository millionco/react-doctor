import { useEffect } from "react";

const handleResize = () => undefined;

interface MixedEffectProperties {
  usePrimaryCallback: boolean;
}

export const MixedEffect = ({ usePrimaryCallback }: MixedEffectProperties) => {
  const effectCallback = usePrimaryCallback ? () => undefined : () => undefined;
  useEffect(effectCallback, [effectCallback]);
  useEffect(() => {
    window.addEventListener("resize", handleResize);
  }, []);

  return null;
};
