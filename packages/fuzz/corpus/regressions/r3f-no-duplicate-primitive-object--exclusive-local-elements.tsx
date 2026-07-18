// rule: r3f-no-duplicate-primitive-object
// weakness: control-flow
// source: Cursor Bugbot review of PR #1371
import "@react-three/fiber";

export const Scene = ({ scene, detail }) => {
  const summary = <primitive object={scene} />;
  const expanded = <primitive object={scene} />;
  const content = detail ? expanded : summary;
  return content;
};
