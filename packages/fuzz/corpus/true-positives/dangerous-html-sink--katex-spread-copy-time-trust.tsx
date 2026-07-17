// rule: dangerous-html-sink
// weakness: copy-tracking
// source: PR #1324 Bugbot review

import katex from "katex";

const source = { trust: true };
const options = { ...source };
source.trust = false;

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
);
