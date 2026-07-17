// rule: r3f-no-duplicate-primitive-object
export const Scene = ({ scene, detail }) => {
  let content;
  if (detail) {
    content = <primitive object={scene} />;
  } else {
    content = <primitive object={scene} />;
  }
  return content;
};
