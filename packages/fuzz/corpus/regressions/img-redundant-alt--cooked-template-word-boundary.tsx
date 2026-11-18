// rule: img-redundant-alt
// weakness: cooked-template-word-boundary
// source: synthetic audit regression
export const Preview = () => <img src="/leaf.png" alt={`Photo${"synthesis"} in a leaf`} />;
