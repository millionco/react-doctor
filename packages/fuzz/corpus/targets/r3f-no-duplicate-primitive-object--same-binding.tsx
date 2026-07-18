// rule: r3f-no-duplicate-primitive-object
import "@react-three/fiber";

export const Scene = ({ scene }) => (
  <>
    <primitive object={scene} />
    <primitive object={scene} />
  </>
);
