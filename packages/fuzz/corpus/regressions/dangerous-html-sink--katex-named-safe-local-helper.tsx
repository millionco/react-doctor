// rule: dangerous-html-sink
// weakness: name-heuristic
// source: PR #1324 Bugbot review

import katex from "katex";

function renderKaTeX(value: string): string | null {
  try {
    return katex.renderToString(value, { throwOnError: true });
  } catch {
    return null;
  }
}

export const MathNode = ({ value }: { value: string }) => {
  const html = renderKaTeX(value);
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{value}</code>;
};
