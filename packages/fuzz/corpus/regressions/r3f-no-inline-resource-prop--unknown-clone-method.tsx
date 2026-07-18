// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";

export const Scene = ({ cloneableGeometryConfig, cloneableMaterialConfig }) => (
  <mesh geometry={cloneableGeometryConfig.clone()} material={cloneableMaterialConfig.clone()} />
);
