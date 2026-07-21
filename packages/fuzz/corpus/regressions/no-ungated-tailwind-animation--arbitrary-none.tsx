// rule: no-ungated-tailwind-animation
// weakness: arbitrary-value
// source: adversarial all-rules parity review
// verdict: pass

export const StaticStatus = () => <span className="animate-[none]" />;
