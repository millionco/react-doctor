// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";

const THREE = require("three");

THREE.BufferGeometry = ReplacementGeometry;

export const Scene = () => <mesh geometry={new THREE.BufferGeometry()} />;
