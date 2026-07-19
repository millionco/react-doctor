// rule: r3f-no-allocation-in-pointer-move
import "@react-three/fiber";

export const Scene = () => (
  <mesh
    onPointerMove={(event) => {
      const ray = event.ray.clone();
      const uv = event.uv.clone();
      const normal = event.normal.clone();
      consume(ray, uv, normal);
    }}
  />
);
