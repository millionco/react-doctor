// rule: no-ungated-tailwind-animation
// weakness: framework-gating
// source: Tailwind CSS built-in animation and prefers-reduced-motion documentation
// verdict: fail

export const ReducedMotionSpinner = () => <span className="motion-reduce:animate-spin" />;
