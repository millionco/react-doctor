// rule: r3f-no-inline-primitive-object
import "@react-three/fiber";

export const Scene = ({ scene }) => <primitive object={scene.clone()} />;
