// rule: r3f-no-unstable-args
// source: React Three Fiber constructor-argument stability contract
import { Canvas } from "@react-three/fiber";

export const UnstableArgsScene = () => <line args={[{ width: 1 }]} />;

export const App = () => (
  <Canvas>
    <UnstableArgsScene />
  </Canvas>
);
