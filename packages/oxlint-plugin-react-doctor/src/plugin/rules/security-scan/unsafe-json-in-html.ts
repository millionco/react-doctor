import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { findMatchingBracket } from "./utils/find-matching-bracket.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { getScannableContent } from "./utils/scan-by-pattern.js";

// Each pattern ends on the `JSON.stringify(` token so the value can be checked
// individually — a per-sink decision, not a file-wide one.
//   1. `dangerouslySetInnerHTML={{ __html: … JSON.stringify( … }}`
//   2. `JSON.stringify(` inside one inline `<script>…</script>` element.
// `JSON.stringify` does NOT HTML-escape, so a value containing `</script>`,
// `<`, or U+2028/U+2029 breaks out of the markup — the classic SSR
// data-hydration XSS that `dangerous-html-sink` does not treat as tainted.
const SINK_JSON_STRINGIFY_PATTERNS = [
  /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:[\s\S]{0,300}?\bJSON\.stringify\s*\(/gi,
  /<script\b[^>]*>(?:(?!<\/script>)[\s\S]){0,300}?\bJSON\.stringify\s*\(/gi,
];
const INLINE_SCRIPT_PATTERN_INDEX = 1;

// A `JSON.stringify` between a `<script>` tag and its close only serializes
// into MARKUP when it sits inside a template interpolation (`${…}`) or a
// string-concat junction (`" + JSON.stringify(...)`). Otherwise it is part of
// the script's own source and runs in the browser at runtime — nothing is
// embedded into HTML at render time.
const MARKUP_INTERPOLATION_JUNCTION_PATTERN = /\$\{|["'`]\s*\+\s*$/;

// `<script>{…}</script>` in JSX renders the expression as a TEXT child, and
// React HTML-escapes text children — a `</script>` breakout is impossible.
// `{{` is excluded: that shape only appears in attribute position.
const JSX_EXPRESSION_CHILD_PATTERN = /^\s*\{(?!\{)/;

const STRING_LITERAL_PATTERN = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const JSON_KEYWORD_OR_NUMBER_PATTERN = /\b(?:true|false|null)\b|[\d.]+(?:e[+-]?\d+)?/gi;

// A stringify argument built entirely from literals (`JSON.stringify({
// "@context": "https://schema.org", … })`) has no data flow at all — nothing
// attacker-influenced can reach the sink. Any bare identifier, call, or
// template interpolation in the argument keeps the finding.
const isFullyStaticJsonArgument = (argumentText: string): boolean => {
  if (argumentText.includes("`") || argumentText.includes("${")) return false;
  const withoutStrings = argumentText.replace(STRING_LITERAL_PATTERN, "");
  const withoutKeywords = withoutStrings.replace(JSON_KEYWORD_OR_NUMBER_PATTERN, "");
  return !/[A-Za-z_$]/.test(withoutKeywords);
};

// Only escaping the OUTPUT of JSON.stringify is safe: a `.replace` of `<` on
// its return value, or an escape/serializer helper wrapping the whole call.
// Escaping the INPUT (a helper inside the stringify arguments) does not, so the
// return-value check looks strictly after the call's matching `)`.
const RETURN_ESCAPE_PATTERN = /^[\s)]*\.replace\s*\([^)]*(?:\\u003[cC]|&lt;|<)/;
// HTML-escape helpers are trusted even as methods (`utils.escapeHtml(...)`),
// but the generic serializer names must be bare calls — a `.serialize(...)`
// method is unrelated to serialize-javascript and may not HTML-escape.
const ESCAPE_WRAPPER_PATTERN =
  /(?:\b(?:escapeHtml|escapeJSON|escapeJson|htmlEscape|jsesc)|(?<![.\w])(?:serialize|serializeJavascript|devalue|uneval|superjson))\s*\(\s*$/i;
const JSON_STRINGIFY_TOKEN_PATTERN = /\bJSON\.stringify\s*\($/i;
const RETURN_LOOKAHEAD_CHARS = 160;

export const unsafeJsonInHtml = defineRule({
  id: "unsafe-json-in-html",
  title: "Unescaped JSON in HTML or script sink",
  severity: "warn",
  recommendation:
    'JSON.stringify does not HTML-escape, so a `</script>` (or `<`) in the data breaks out and becomes XSS. Use an HTML-safe serializer (serialize-javascript, devalue) or escape `<`, `>`, and `&`, or pass data via a JSON `<script type="application/json">` read with JSON.parse.',
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];
    const content = getScannableContent(file);
    if (!content.includes("JSON.stringify")) return [];

    const findings: ScanFinding[] = [];
    const seenIndices = new Set<number>();
    for (const [patternIndex, pattern] of SINK_JSON_STRINGIFY_PATTERNS.entries()) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
        // An escape/serializer helper wrapping the call escapes the output.
        const beforeStringify = match[0].replace(JSON_STRINGIFY_TOKEN_PATTERN, "");
        if (ESCAPE_WRAPPER_PATTERN.test(beforeStringify)) continue;

        if (patternIndex === INLINE_SCRIPT_PATTERN_INDEX) {
          const tagCloseIndex = content.indexOf(">", match.index);
          const stringifyTokenOffset = match[0].search(/\bJSON\.stringify\s*\($/i);
          if (tagCloseIndex >= 0 && stringifyTokenOffset >= 0) {
            const betweenTagAndStringify = content.slice(
              tagCloseIndex + 1,
              match.index + stringifyTokenOffset,
            );
            if (!MARKUP_INTERPOLATION_JUNCTION_PATTERN.test(betweenTagAndStringify)) continue;
            if (JSX_EXPRESSION_CHILD_PATTERN.test(betweenTagAndStringify)) continue;
          }
        }

        // A `.replace` of `<` applied to the call's return value escapes it.
        const openParenIndex = match.index + match[0].length - 1;
        const closeParenIndex = findMatchingBracket(content, openParenIndex);
        if (closeParenIndex >= 0) {
          const afterReturn = content.slice(
            closeParenIndex + 1,
            closeParenIndex + 1 + RETURN_LOOKAHEAD_CHARS,
          );
          if (RETURN_ESCAPE_PATTERN.test(afterReturn)) continue;

          if (isFullyStaticJsonArgument(content.slice(openParenIndex + 1, closeParenIndex))) {
            continue;
          }
        }

        if (seenIndices.has(match.index)) continue;
        seenIndices.add(match.index);
        const location = getLocationAtIndex(content, match.index);
        findings.push({
          message:
            "JSON.stringify is embedded in HTML/script markup without HTML-escaping; data containing `</script>` or `<` breaks out and becomes XSS.",
          line: location.line,
          column: location.column,
        });
      }
    }
    return findings;
  },
});
