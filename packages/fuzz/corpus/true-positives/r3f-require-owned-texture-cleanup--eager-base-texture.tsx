// rule: r3f-require-owned-texture-cleanup
// weakness: eager-hook-allocation
// source: FN audit pmndrs/drei@c9d3d0dc src/core/useSpriteLoader.tsx
import { Texture } from "three";
import { useState } from "react";

export const Scene = ({ loadedTexture }) => {
  const [texture, setTexture] = useState(new Texture());
  if (loadedTexture) setTexture(loadedTexture);
  return <meshBasicMaterial map={texture} />;
};
