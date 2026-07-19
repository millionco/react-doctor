import { Canvas } from "@react-three/fiber/webgpu";

export const LegacyShader = () => (
  <Canvas>
    <mesh>
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} />
    </mesh>
  </Canvas>
);
