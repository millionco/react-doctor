// rule: r3f-require-owned-texture-cleanup
// weakness: borrowed-material-reference
// source: lifecycle audit
import { useMemo, useState } from "react";
import { CanvasTexture, MeshBasicMaterial } from "three";

export const Scene = ({ canvas }) => {
  const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
  const [material] = useState(() => new MeshBasicMaterial());
  material.map = texture;
  return <primitive object={material} />;
};
