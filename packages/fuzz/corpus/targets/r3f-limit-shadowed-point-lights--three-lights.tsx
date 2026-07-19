// rule: r3f-limit-shadowed-point-lights
import "@react-three/fiber";

export const Scene = () => (
  <>
    <pointLight castShadow />
    <pointLight castShadow />
    <pointLight castShadow />
  </>
);
