// rule: r3f-no-recursive-raf-with-use-frame
import { useFrame } from "@react-three/fiber";

const Scene = () => {
  useFrame(() => updateScene());
  const animate = () => {
    updateOverlay();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  return null;
};

export default Scene;
