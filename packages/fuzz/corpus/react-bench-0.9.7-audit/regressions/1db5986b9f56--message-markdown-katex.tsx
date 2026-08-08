// rule: dangerous-html-sink
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 1db5986b9f56ef83779c2104b228aee5f2a39640b2e84a2b555288bdfe1eed36
import katex from "katex";
import "katex/dist/katex.min.css";
import { memo, useMemo } from "react";

const ESCAPE_HTML_PATTERN = /[&<>"']/g;
const ESCAPE_HTML_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(ESCAPE_HTML_PATTERN, (char) => ESCAPE_HTML_MAP[char]);
}

/**
 * KaTeX rejects a bare `_` in text mode, but messages routinely wrap
 * snake_case identifiers in `\text{...}` (e.g. `\text{avg_row_size}`).
 * Escaping underscores inside `\text{...}` spans only - so `x_i` outside
 * text mode is untouched - lets those render as literal text instead of
 * throwing.
 */
export function escapeTextModeUnderscores(latex: string): string {
  const marker = "\\text{";
  let result = "";
  let lastIndex = 0;
  let searchFrom = 0;

  let start = latex.indexOf(marker, searchFrom);
  while (start !== -1) {
    let depth = 1;
    let i = start + marker.length;
    while (i < latex.length && depth > 0) {
      if (latex[i] === "{") {
        depth++;
      } else if (latex[i] === "}") {
        depth--;
      }
      if (depth > 0) {
        i++;
      }
    }

    result += latex.slice(lastIndex, start + marker.length);
    const content = latex.slice(start + marker.length, i);
    result += content.replace(/(?<!\\)_/g, "\\_");
    lastIndex = i;
    searchFrom = i;
    start = latex.indexOf(marker, searchFrom);
  }

  result += latex.slice(lastIndex);
  return result;
}

/**
 * Renders LaTeX to KaTeX HTML. Uses `throwOnError: false` so a syntactically
 * closed but invalid expression (e.g. `\frac{`) still renders through KaTeX
 * with its standard error styling instead of throwing.
 */
export function renderKatexHtml(value: string, displayMode: boolean): string {
  try {
    return katex.renderToString(escapeTextModeUnderscores(value), {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return `<span class="katex-error">${escapeHtml(value)}</span>`;
  }
}

interface MessageMarkdownKatexProps {
  value: string;
  displayMode: boolean;
}

export const MessageMarkdownKatex = memo(function MessageMarkdownKatex({
  value,
  displayMode,
}: MessageMarkdownKatexProps) {
  const html = useMemo(() => renderKatexHtml(value, displayMode), [value, displayMode]);

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
});
