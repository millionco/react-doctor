// rule: r3f-no-recursive-raf-with-use-frame
import { useFrame, useThree } from "@react-three/fiber";

export const Scene = () => {
  const gl = useThree((state) => state.gl);
  useFrame(() => updateScene());
  gl.setAnimationLoop(() => gl.render(scene, camera));
  return null;
};
