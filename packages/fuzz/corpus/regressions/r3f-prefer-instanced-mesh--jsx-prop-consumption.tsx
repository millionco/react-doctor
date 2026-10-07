// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: render-consumption
// source: adversarial-fuzz
import "@react-three/fiber";

export const Scene = ({ geometry, material }) => {
  const samples = [0, 1].map((index) => (
    <mesh key={index} geometry={geometry} material={material} />
  ));
  return <group userData={{ samples }} />;
};
