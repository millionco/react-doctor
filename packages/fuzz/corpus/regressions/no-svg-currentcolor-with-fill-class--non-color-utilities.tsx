// rule: no-svg-currentcolor-with-fill-class
// weakness: name-heuristic
// source: PR #850 Cursor Bugbot review

export const Icon = () => (
  <svg
    fill="currentColor"
    stroke="currentColor"
    className="fill-none stroke-linecap-round stroke-[.5]"
  />
);
