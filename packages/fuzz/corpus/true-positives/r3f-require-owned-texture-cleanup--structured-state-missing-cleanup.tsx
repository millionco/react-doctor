// rule: r3f-require-owned-texture-cleanup
// weakness: wrapper-transparency
// source: adversarial audit
import { useState } from "react";
import { CanvasTexture } from "three";

export const Scene = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
  return <primitive object={resources.texture} />;
};
