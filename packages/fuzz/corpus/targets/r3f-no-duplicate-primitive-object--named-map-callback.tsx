// rule: r3f-no-duplicate-primitive-object
// weakness: callback-resolution
// source: adversarial integration review
import "@react-three/fiber";

export const Scene = ({ scene }) => {
  const renderPrimitive = (side) => <primitive key={side} object={scene} />;
  return ["left", "right"].map(renderPrimitive);
};
