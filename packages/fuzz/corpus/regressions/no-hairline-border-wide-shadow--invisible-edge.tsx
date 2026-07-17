// rule: no-hairline-border-wide-shadow
// weakness: static-value-guard
// source: self-review

export const Cards = () => (
  <>
    <div className="border border-transparent shadow-2xl" />
    <div className="border shadow-2xl shadow-none" />
  </>
);
