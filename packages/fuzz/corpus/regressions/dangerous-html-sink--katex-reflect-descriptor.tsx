// rule: dangerous-html-sink
// weakness: other
// source: PR #1324 Bugbot review

import katex from "katex";

const options = { trust: true };
Reflect.defineProperty(options, "trust", { value: false });

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
);
