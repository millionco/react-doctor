// rule: r3f-no-unstable-args
// weakness: library-idiom
// source: pmndrs/examples@a2700f7983cadaa1d90a6d4ddda0acab2f0a29fe/demos/basic-demo/src/App.jsx
import { Canvas } from "@react-three/fiber";

export const ScalarConstructorArguments = () => (
  <Canvas>
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  </Canvas>
);
