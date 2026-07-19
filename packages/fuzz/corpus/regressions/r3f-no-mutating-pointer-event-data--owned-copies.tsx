// rule: r3f-no-mutating-pointer-event-data
import "@react-three/fiber";

export const Scene = () => (
  <mesh
    onPointerMove={(event) => {
      const normal = event.normal.clone();
      const ray = event.ray.clone();
      normal.normalize();
      ray.origin.set(0, 0, 0);
    }}
  />
);
