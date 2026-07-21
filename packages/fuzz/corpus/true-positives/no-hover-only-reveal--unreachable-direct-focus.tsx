// rule: no-hover-only-reveal
// weakness: focusability
// source: adversarial accessibility contract audit
// verdict: fail

export const HoverMenu = () => <div className="hidden hover:block focus:block">Actions</div>;
