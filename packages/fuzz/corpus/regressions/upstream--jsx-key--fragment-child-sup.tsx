// rule: react/jsx-key
// weakness: other
// source: oxc-project/oxc#3388 (inner <sup> inside array fragment wrongly flagged; only the encasing <> lacks a key)
export const Footnotes = () => [
  <>
    note<sup>1</sup>
  </>,
];
