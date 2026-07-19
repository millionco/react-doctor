// rule: r3f-require-projection-matrix-update
// weakness: control-flow
// source: coldi/r3f-game-demo CameraFollowScript previous-zoom guard
import { useFrame } from "@react-three/fiber";

export const CameraFollow = ({ nextZoom }) => {
  useFrame(({ camera }) => {
    const previousZoom = camera.zoom;
    camera.zoom = nextZoom;
    if (camera.zoom !== previousZoom) camera.updateProjectionMatrix();
  });
  return null;
};
