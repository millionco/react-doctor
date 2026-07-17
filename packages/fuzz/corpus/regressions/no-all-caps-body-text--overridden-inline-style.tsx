// rule: no-all-caps-body-text
// weakness: last-property-wins
// source: Bugbot review on PR #850
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const SentenceCaseParagraph = () => (
  <p style={{ textTransform: "uppercase", textTransform: "none" }}>
    This paragraph contains enough readable copy to verify that the final transform remains
    effective.
  </p>
);
