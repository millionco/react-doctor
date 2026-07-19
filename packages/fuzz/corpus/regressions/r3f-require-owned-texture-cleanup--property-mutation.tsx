// rule: r3f-require-owned-texture-cleanup
// weakness: copy-tracking
// source: Daytona parity, darkroomengineering/satus
import { useEffect, useMemo } from "react";
import { CanvasTexture } from "three";

export const Scene = ({ canvas }) => {
  let texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  texture.needsUpdate = true;
  return <primitive object={texture} />;
};
