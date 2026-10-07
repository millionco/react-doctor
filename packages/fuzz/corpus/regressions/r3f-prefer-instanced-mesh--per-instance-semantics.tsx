// verdict: pass
// rule: r3f-prefer-instanced-mesh
// weakness: library-idiom
// source: adversarial-audit
import "@react-three/fiber";

export const Scene = ({ geometry, material, props }) => (
  <>
    {[0, 1].map((index) => (
      <mesh key={index} geometry={geometry} material={material}>
        <group />
      </mesh>
    ))}
    {[0, 1].map((index) => (
      <mesh key={index} geometry={geometry} material={material} visible={false} />
    ))}
    {[0, 1].map((index) => (
      <mesh key={index} geometry={geometry} material={material} attach="customObject" />
    ))}
    {[0, 1].map((index) => (
      <mesh key={index} {...props} geometry={geometry} material={material} />
    ))}
  </>
);
