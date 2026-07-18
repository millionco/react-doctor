// rule: r3f-no-duplicate-primitive-object
import "@react-three/fiber";

export const Scene = ({ props, scene }) => (
  <>
    <primitive object={scene} {...props} />
    <primitive object={scene} />
  </>
);
