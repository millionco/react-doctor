// rule: no-svg-currentcolor-with-fill-class
// weakness: arbitrary-value
// source: adversarial parity review
// verdict: pass

export const Icon = () => <svg fill="currentColor" className="fill-[currentColor]" />;
