// rule: anchor-target-exists
// weakness: hidden-subtree
// source: Cursor Bugbot PR #1561
// verdict: fail

export const TemplateContentTarget = () => (
  <>
    <a href="#about">About</a>
    <template>
      <main id="about" />
    </template>
  </>
);
