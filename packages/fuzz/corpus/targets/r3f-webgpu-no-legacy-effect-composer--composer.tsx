import { Canvas } from "@react-three/fiber/webgpu";
import { EffectComposer } from "@react-three/postprocessing";

export const LegacyPostprocessing = () => (
  <Canvas>
    <EffectComposer />
  </Canvas>
);
