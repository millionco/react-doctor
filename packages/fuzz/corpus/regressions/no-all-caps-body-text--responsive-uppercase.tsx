// rule: no-all-caps-body-text
// weakness: variant-scope
// source: Bugbot review on PR #850

export const ResponsiveUppercaseParagraph = () => (
  <p className="md:uppercase">
    This paragraph contains enough readable copy to remain sentence case at the base breakpoint.
  </p>
);
