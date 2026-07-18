// rule: r3f-no-duplicate-primitive-object
// source: Cursor Bugbot review on PR #1371
const scene = {};

export const Scene = () => (
  <>
    {(() => {
      return <primitive object={scene} />;
    })()}
    <primitive object={scene} />
  </>
);
