// rule: r3f-no-recursive-raf-with-use-frame
import { useFrame, useThree } from "@react-three/fiber";
import { renderScene } from "./animation";

export const Scene = () => {
  const gl = useThree((state) => state.gl);
  useFrame(() => updateScene());
  gl.setAnimationLoop(renderScene);
  return null;
};
