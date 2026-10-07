// rule: dangerous-html-sink
// weakness: test-path-classification
// source: ReactBench test-katex-error.tsx exact replay

export const Fixture = ({ html }: { html: string }) => (
  <span dangerouslySetInnerHTML={{ __html: html }} />
);
