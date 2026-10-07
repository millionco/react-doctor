// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: control-flow
// source: bugbot-review
import "@react-three/fiber";

export const Scene = ({ firstGeometry, material }) => {
  const resources = { geometry: firstGeometry, material };
  return [0, 1].map((index) => {
    const updateResources = () => {
      resources.geometry = createGeometry(index);
    };
    updateResources();
    return <mesh key={index} geometry={resources.geometry} material={resources.material} />;
  });
};
