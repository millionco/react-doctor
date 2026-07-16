// rule: dangerous-html-sink
// weakness: name-heuristic
// source: React Bench Datastoria MofFZfj

import katex from "katex";

const renderMathToHtml = (value: string): string => {
  try {
    return katex.renderToString(value, { throwOnError: false });
  } catch {
    return value;
  }
};

export const MathNode = ({ value }: { value: string }) => (
  <span dangerouslySetInnerHTML={{ __html: renderMathToHtml(value) }} />
);
