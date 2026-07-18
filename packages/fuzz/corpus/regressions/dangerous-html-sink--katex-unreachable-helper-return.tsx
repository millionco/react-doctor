// rule: dangerous-html-sink
// weakness: control-flow
// source: PR #1324 Bugbot review

import katex from "katex";

const renderMath = (value: string) => {
  try {
    return katex.renderToString(value);
  } catch {
    return null;
  }
  return value;
};

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
);
