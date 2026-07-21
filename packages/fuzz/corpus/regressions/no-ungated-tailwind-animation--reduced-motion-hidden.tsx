// rule: no-ungated-tailwind-animation
// weakness: framework-escape-hatch
// source: Tailwind CSS prefers-reduced-motion documentation
// verdict: pass

export const Processing = () => (
  <button type="button">
    <svg className="animate-spin motion-reduce:hidden" aria-hidden="true" />
    Processing
  </button>
);
