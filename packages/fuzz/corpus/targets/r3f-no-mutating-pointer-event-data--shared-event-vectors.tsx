// rule: r3f-no-mutating-pointer-event-data
import "@react-three/fiber";

export const Scene = () => (
  <mesh
    onPointerMove={(event) => {
      event.ray.origin.set(0, 0, 0);
      event.uv.x = 0;
      event.normal.normalize();
    }}
  />
);
