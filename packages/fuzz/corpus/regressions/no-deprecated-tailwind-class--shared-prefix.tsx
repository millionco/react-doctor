// rule: no-deprecated-tailwind-class
// weakness: name-heuristic
// source: PR #850 Cursor Bugbot review

export const CustomUtilities = () => (
  <div className="flex-shrinkable flex-grower bg-gradient-to-random" />
);
