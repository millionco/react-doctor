// rule: r3f-require-owned-texture-cleanup
import { useEffect, useState } from "react";
import { CanvasTexture } from "three";

export const Scene = ({ canvas }) => {
  const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
  const texture = resources.texture;
  useEffect(() => () => texture.dispose(), [texture]);
  return <primitive object={texture} />;
};
