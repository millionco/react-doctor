// verdict: fail
// rule: r3f-prefer-instanced-mesh
// weakness: render-consumption
// source: adversarial-fuzz
import "@react-three/fiber";

export const Scene = ({ geometry, material }) => {
  const meshes = [0, 1].map((index) => (
    <mesh key={index} geometry={geometry} material={material} />
  ));
  return <group>{meshes}</group>;
};
