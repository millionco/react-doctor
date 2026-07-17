// rule: no-skipped-heading-level
// weakness: wrapper-transparency
// source: Bugbot review on PR #850

export const FragmentHeadingOutline = () => (
  <main>
    <>
      <h1>Title</h1>
      <>
        <h3>Details</h3>
      </>
    </>
  </main>
);
