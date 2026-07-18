// rule: r3f-no-duplicate-primitive-object
// weakness: control-flow
// source: deep fuzz semantic review of PR #1371 against react-bench-5

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
