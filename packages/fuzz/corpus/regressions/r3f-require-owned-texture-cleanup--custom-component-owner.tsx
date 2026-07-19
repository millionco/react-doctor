// rule: r3f-require-owned-texture-cleanup
import { ManagedTexture } from "./managed-texture";
import { CanvasTexture } from "three";
import { useMemo } from "react";

export const Scene = ({ canvas }) => {
  const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
  return <ManagedTexture texture={texture} />;
};
