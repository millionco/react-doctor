// rule: dangerous-html-sink
// weakness: option-provenance
// source: React Bench Datastoria audit

import katex from "katex";

interface MathPreviewProps {
  options: object;
  value: string;
}

export const MathPreview = ({ options, value }: MathPreviewProps) => (
  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
);
