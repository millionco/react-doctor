// rule: anchor-target-exists
// weakness: cross-file
// source: Cursor Bugbot PR #1561
// verdict: pass

export const SpreadOverStaticId = ({ elementProps }) => (
  <>
    <a href="#about">About</a>
    <main id="about" {...elementProps} />
  </>
);
