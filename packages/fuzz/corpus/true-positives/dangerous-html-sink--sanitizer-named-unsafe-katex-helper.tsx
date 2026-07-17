// rule: dangerous-html-sink
// weakness: name-heuristic
// source: PR #1324 Bugbot review

import katex from "katex";

const sanitizeMathHtml = (value: string): string => {
  try {
    return katex.renderToString(value, { throwOnError: true });
  } catch {
    return value;
  }
};

export const MathNode = ({ value }: { value: string }) => {
  const html = sanitizeMathHtml(value);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};
