// rule: r3f-no-inline-primitive-object
import "@react-three/fiber";

export const Scene = ({ props, scene }) => <primitive object={scene.clone()} {...props} />;
