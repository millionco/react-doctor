// rule: no-tight-body-leading
// weakness: variant-scope
// source: Bugbot review on PR #850

export const ResponsiveLeadingParagraph = () => (
  <p className="lg:leading-tight">
    This paragraph contains enough readable copy to remain comfortable at the base breakpoint.
  </p>
);
