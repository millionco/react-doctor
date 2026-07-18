// rule: r3f-no-duplicate-primitive-object
import "@react-three/fiber";

export const Scene = ({ scene, detail }) => {
  let content;
  if (detail) {
    content = <primitive object={scene} />;
  } else {
    content = <primitive object={scene} />;
  }
  return content;
};
