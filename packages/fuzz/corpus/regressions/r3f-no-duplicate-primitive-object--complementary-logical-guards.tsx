// rule: r3f-no-duplicate-primitive-object
// weakness: control-flow
// source: deep fuzz semantic review of PR #1371 against react-bench-5

import "@react-three/fiber";

const _Scene = ({ scene, detail }) => (
  <>
    {detail && <primitive object={scene} />}
    {!detail && <primitive object={scene} />}
  </>
);

const _TernaryScene = ({ scene, detail }) => (
  <>
    {detail ? <primitive object={scene} /> : null}
    {!detail ? <primitive object={scene} /> : null}
  </>
);

const _AlternateTernaryScene = ({ scene, detail }) => (
  <>
    {detail ? <primitive object={scene} /> : null}
    {detail ? null : <primitive object={scene} />}
  </>
);

const _OrScene = ({ scene, detail }) => (
  <>
    {detail || <primitive object={scene} />}
    {detail && <primitive object={scene} />}
  </>
);

const _SiblingIfScene = ({ scene, detail }) => {
  let first = null;
  let second = null;
  if (detail) first = <primitive object={scene} />;
  if (!detail) second = <primitive object={scene} />;
  return (
    <>
      {first}
      {second}
    </>
  );
};
