import "@react-three/fiber";

export const LocalPoint = ({ group }) => (
  <mesh onPointerMove={(event) => group.worldToLocal(event.point)} />
);
