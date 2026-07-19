// rule: r3f-require-owned-texture-cleanup
// weakness: wrapper-transparency
// source: adversarial audit
import { useMemo } from "react";
import { CanvasTexture } from "three";
import { ManagedMaterial } from "./managed-material";

export const Scene = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
  const uniforms = useMemo(() => ({ map: { value: texture } }), [texture]);
  return <ManagedMaterial uniforms={uniforms} />;
};
