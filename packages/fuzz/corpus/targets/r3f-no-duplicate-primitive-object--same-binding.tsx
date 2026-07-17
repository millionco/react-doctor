// rule: r3f-no-duplicate-primitive-object
export const Scene = ({ scene }) => (
  <>
    <primitive object={scene} />
    <primitive object={scene} />
  </>
);
