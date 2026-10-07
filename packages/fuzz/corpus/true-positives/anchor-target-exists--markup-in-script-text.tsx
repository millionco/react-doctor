// rule: anchor-target-exists
// weakness: cross-file
// source: Cursor Bugbot PR #1561
// verdict: fail

export const MissingTargetWithMarkupText = () => (
  <>
    <a href="#about">About</a>
    <script>{`const markup = '<main id="about"></main>';`}</script>
  </>
);
