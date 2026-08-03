// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: getter-identity
// source: adversarial-audit
import "@react-three/fiber";

export const Scene = ({ material }) => {
  const resources = {
    get geometry() {
      return createGeometry();
    },
    material,
  };
  return [0, 1].map((index) => (
    <mesh key={index} geometry={resources.geometry} material={resources.material} />
  ));
};
