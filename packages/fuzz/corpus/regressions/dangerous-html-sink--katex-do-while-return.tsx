// rule: dangerous-html-sink
// weakness: control-flow
// source: PR #1324 Bugbot review

import katex from "katex";

declare const shouldRetry: () => boolean;

const renderMath = (value: string) => {
  do {
    return katex.renderToString(value);
  } while (shouldRetry());
  return value;
};

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
);
