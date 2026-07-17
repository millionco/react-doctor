// rule: no-tight-body-leading
// weakness: last-property-wins
// source: Bugbot review on PR #850
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const ComfortableParagraph = () => (
  <p style={{ lineHeight: 1.1, lineHeight: 1.5 }}>
    This paragraph contains enough words to wrap across several lines in a typical content column.
  </p>
);
