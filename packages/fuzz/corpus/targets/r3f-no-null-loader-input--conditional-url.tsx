// rule: r3f-no-null-loader-input
// source: official R3F useLoader input contract
import { useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";

export const NullableTextureScene = ({ enabled, url }) => {
  const texture = useLoader(TextureLoader, enabled ? url : null);
  return <meshBasicMaterial map={texture} />;
};
