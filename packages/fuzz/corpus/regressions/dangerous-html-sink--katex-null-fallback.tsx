// rule: dangerous-html-sink
// weakness: control-flow
// source: React Bench Datastoria G9giV2h

import katex from "katex";

const renderMath = (value: string): string | null => {
  try {
    return katex.renderToString(value, { throwOnError: true });
  } catch {
    return null;
  }
};

export const MathNode = ({ value }: { value: string }) => {
  const html = renderMath(value);
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{value}</code>;
};
