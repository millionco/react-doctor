// rule: no-ungated-tailwind-animation
// weakness: utility-cascade
// source: Tailwind utility cascade contract audit
// verdict: pass

export const AmbiguousAnimations = () => (
  <>
    <span className="animate-spin animate-none" />
    <span className="animate-none animate-spin" />
    <span className="!animate-spin !animate-none" />
  </>
);
