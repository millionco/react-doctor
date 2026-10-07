// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: copy-tracking
// source: adversarial-audit
import "@react-three/fiber";

export const Scene = ({ firstGeometry, material }) => {
  const resources = { geometry: firstGeometry, material };
  return [0, 1].map((index) => {
    resources.geometry = createGeometry(index);
    return <mesh key={index} geometry={resources.geometry} material={resources.material} />;
  });
};
