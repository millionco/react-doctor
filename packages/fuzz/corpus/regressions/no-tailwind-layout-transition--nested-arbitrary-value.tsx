// rule: no-tailwind-layout-transition
// weakness: name-heuristic
// source: PR #850 Cursor Bugbot review

export const TransitionLabel = () => <div className="before:content-['transition-[height]']" />;
