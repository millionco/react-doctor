// rule: r3f-no-inline-primitive-object
import "@react-three/fiber";

export const Scene = ({ builder, child, Object }) => (
  <>
    <primitive object={builder.add(child)} />
    <primitive object={Object.create(child)} />
  </>
);
