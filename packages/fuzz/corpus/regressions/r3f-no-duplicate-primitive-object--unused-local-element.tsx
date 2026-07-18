// rule: r3f-no-duplicate-primitive-object
// weakness: liveness
// source: Cursor Bugbot review of PR #1371
import "@react-three/fiber";

export const Scene = ({ scene }) => {
  const unused = <primitive object={scene} />;
  return <primitive object={scene} />;
};
