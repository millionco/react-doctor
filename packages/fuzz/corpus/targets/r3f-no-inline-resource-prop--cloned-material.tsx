// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";

export const Scene = ({ material }) => <mesh material={material.clone()} />;
