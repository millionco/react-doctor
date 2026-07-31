// rule: dangerous-html-sink
// weakness: test-path-classification
// source: adversarial audit of ReactBench test-katex-error.tsx

export const Preview = ({ html }: { html: string }) => (
  <span dangerouslySetInnerHTML={{ __html: html }} />
);
