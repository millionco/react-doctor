// rule: dangerous-html-sink
// weakness: other
// source: PR #1324 Bugbot review

import DOMPurify from "dompurify";
import katex from "katex";

DOMPurify.renderToString = (value: string) => value;

const renderMath = (value: string) => {
  try {
    return katex.renderToString(value);
  } catch {
    return DOMPurify.sanitize(value);
  }
};

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
);
