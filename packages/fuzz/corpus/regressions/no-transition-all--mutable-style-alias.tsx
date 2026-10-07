// rule: no-transition-all
// weakness: alias-guard
// source: final adversarial review
// verdict: pass

const changedStyle = { transition: "all 200ms" };
changedStyle.transition = "opacity 200ms";

export const StableTransition = () => <div className="transition-all" style={changedStyle} />;
