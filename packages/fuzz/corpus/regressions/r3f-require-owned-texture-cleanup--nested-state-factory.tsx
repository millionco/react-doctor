// rule: r3f-require-owned-texture-cleanup
// weakness: wrapper-transparency
// source: adversarial audit
import { useEffect, useState } from "react";
import { CanvasTexture } from "three";

export const Scene = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
  useEffect(() => () => resources.texture.dispose(), [resources]);
  return <primitive object={resources.texture} />;
};
