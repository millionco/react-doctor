// rule: dangerous-html-sink
// weakness: logical-expression
// source: PR #1324 Bugbot review

import katex from "katex";

const renderMathHtml = (value: string): string | null => {
  try {
    return katex.renderToString(value, { throwOnError: true });
  } catch {
    return null;
  }
};

export const MathNode = ({ enabled, value }: { enabled: boolean; value: string }) => {
  const safeKatexHtml = renderMathHtml(value);
  const html = enabled && safeKatexHtml;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};
