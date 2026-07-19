// rule: r3f-no-allocation-in-pointer-move
import "@react-three/fiber";

export const Scene = ({ user }) => (
  <mesh onPointerMove={(event) => consume(user.clone(), event.camera.clone())} />
);
