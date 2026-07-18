// rule: r3f-no-unstable-args
import "@react-three/fiber";

export const Scene = ({ props }) => <mesh args={[{ width: 1 }]} {...props} />;
