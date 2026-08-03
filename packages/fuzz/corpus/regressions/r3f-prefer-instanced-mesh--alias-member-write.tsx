// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: alias-guard
// source: adversarial-fuzz
import "@react-three/fiber";

export const Scene = ({ firstGeometry, material }) => {
  const resources = { geometry: firstGeometry, material };
  return [0, 1].map((index) => {
    const mutableResources = resources;
    mutableResources.geometry = createGeometry(index);
    return <mesh key={index} geometry={resources.geometry} material={resources.material} />;
  });
};
