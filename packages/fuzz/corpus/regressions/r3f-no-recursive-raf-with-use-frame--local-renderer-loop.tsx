// rule: r3f-no-recursive-raf-with-use-frame
// weakness: provenance
// source: handbook audit
import { useFrame, useThree } from "@react-three/fiber";
import { WebGLRenderer } from "three";

export const Scene = () => {
  useFrame(() => updateScene());
  const gl = useThree((state) => state.gl);
  const localRenderer = new WebGLRenderer();
  gl.setAnimationLoop(null);
  localRenderer.setAnimationLoop(() => localRenderer.render(scene, camera));
  return null;
};
