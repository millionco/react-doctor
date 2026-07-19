// rule: r3f-require-owned-texture-cleanup
import { useMemo } from "react";
import { CanvasTexture } from "three";

export const Scene = ({ canvas }) => {
  const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
  return <meshStandardMaterial map={texture} />;
};
