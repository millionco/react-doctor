// rule: dangerous-html-sink
// weakness: control-flow
// source: PR #1324 Bugbot review

import katex from "katex";

const options = { trust: true };
try {
  mightThrow();
  options.trust = false;
} catch {}

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
);
