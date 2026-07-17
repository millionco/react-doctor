// rule: no-tight-body-leading
// weakness: unit-semantics
// source: bugbot-pr-850

const BODY_COPY =
  "This paragraph contains enough words to wrap across several lines in a typical content column.";

export const Article = () => <p style={{ fontSize: 16, lineHeight: 18 }}>{BODY_COPY}</p>;
