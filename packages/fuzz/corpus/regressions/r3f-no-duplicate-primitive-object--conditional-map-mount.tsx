// rule: r3f-no-duplicate-primitive-object
// weakness: control-flow
// source: adversarial integration review
import "@react-three/fiber";

export const Scene = ({ scene }) => {
  const renderPrimitive = (item) => item.enabled && <primitive object={scene} />;
  return [{ enabled: true }, { enabled: false }].map(renderPrimitive);
};
