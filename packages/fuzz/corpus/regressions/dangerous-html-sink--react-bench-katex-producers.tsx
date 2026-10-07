// rule: dangerous-html-sink
// verdict: pass
// weakness: cross-file
// source: React Bench 0.9.6 exhaustive audit

import katex from "katex";

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const renderKatexToHtml = (value: string): string => {
  try {
    return katex.renderToString(value, { throwOnError: false, trust: false });
  } catch {
    return `<code>${escapeHtml(value)}</code>`;
  }
};

export const MathMessage = ({ value }: { value: string }) => {
  const html = renderKatexToHtml(value);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};
