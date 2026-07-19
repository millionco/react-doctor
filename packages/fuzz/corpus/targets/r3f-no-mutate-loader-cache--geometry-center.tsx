// rule: r3f-no-mutate-loader-cache
import { useGLTF } from "@react-three/drei";

export const Scene = ({ url }) => {
  const { nodes } = useGLTF(url);
  nodes.Mesh.geometry.center();
  return null;
};
