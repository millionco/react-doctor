// rule: r3f-no-dispose-loader-cache
import { useTexture } from "@react-three/drei";

export const Scene = ({ url }) => {
  const texture = useTexture(url);
  texture.dispose();
  return null;
};
