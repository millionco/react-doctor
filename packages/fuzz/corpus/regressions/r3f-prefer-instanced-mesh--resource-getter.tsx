// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: getter-identity
// source: adversarial-audit
import "@react-three/fiber";

export const Scene = ({ material }) => {
  const meshResources = {
    get geometry() {
      return createGeometry();
    },
  };
  const resources = { mesh: meshResources, material };
  return [0, 1].map((index) => (
    <mesh key={index} geometry={resources.mesh.geometry} material={resources.material} />
  ));
};
