// rule: dangerous-html-sink
// weakness: nullish-fallback
// source: PR #1324 Bugbot review

import katex from "katex";

const renderMath = (value: string) => {
  try {
    return katex.renderToString(value);
  } catch {
    return void 0;
  }
};

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
);
