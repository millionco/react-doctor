// rule: dangerous-html-sink
// weakness: control-flow
// source: PR #1324 Bugbot review

import katex from "katex";

const options = { trust: false };

do {
  options.trust = true;
} while (false);

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
);
