// rule: r3f-no-duplicate-primitive-object
// source: adversarial ownership regression
import "@react-three/fiber";

const scene = {};

export const Scene = () => (
  <>
    {(() => {
      (() => <primitive object={scene} />)();
      return null;
    })()}
    <primitive object={scene} />
  </>
);
