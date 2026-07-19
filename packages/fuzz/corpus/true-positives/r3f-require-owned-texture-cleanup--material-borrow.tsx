// rule: r3f-require-owned-texture-cleanup
// weakness: borrowed-material-reference
// source: lifecycle audit
import { CanvasTexture, MeshBasicMaterial } from "three";

export const Scene = ({ canvas }) => {
  const texture = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({ map: texture });
  return <meshBasicMaterial attach="material" color={material.color} />;
};
