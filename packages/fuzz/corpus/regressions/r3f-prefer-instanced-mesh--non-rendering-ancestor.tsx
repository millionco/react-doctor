// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: ancestor-semantics
// source: adversarial-audit
import "@react-three/fiber";

export const Scene = ({ geometry, material, props }) => (
  <>
    {[0, 1].map((index) => (
      <group key={index} visible={false}>
        <mesh geometry={geometry} material={material} />
      </group>
    ))}
    {[0, 1].map((index) => (
      <group key={index} attach="customObject">
        <mesh geometry={geometry} material={material} />
      </group>
    ))}
    {[0, 1].map((index) => (
      <group key={index} {...props}>
        <mesh geometry={geometry} material={material} />
      </group>
    ))}
  </>
);
