// rule: dangerous-html-sink
// weakness: other
// source: PR #1324 Bugbot review

import katex from "katex";

Object.defineProperties(katex, { version: { value: "1" } });

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
);
