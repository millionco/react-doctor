// rule: no-tailwind-layout-transition
// weakness: domain-semantics
// source: PR #850 Cursor Bugbot review

export const AnimatedBar = () => <rect className="transition-[height]" />;
