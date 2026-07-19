// rule: r3f-require-owned-texture-cleanup
import { useState } from "react";
import { CanvasTexture } from "three";

export const useTextureResources = (canvas) => {
  const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
  return resources;
};
