// rule: r3f-no-recursive-raf-with-use-frame
// weakness: unresolved-callback
// source: lifecycle review
import { useFrame, useThree } from "@react-three/fiber";

export const Scene = ({ animationLoop }) => {
  const gl = useThree((state) => state.gl);
  useFrame(() => updateScene());
  gl.setAnimationLoop(undefined);
  gl.setAnimationLoop(animationLoop);
  return null;
};
