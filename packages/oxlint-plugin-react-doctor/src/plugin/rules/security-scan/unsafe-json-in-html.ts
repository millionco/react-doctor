import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// `JSON.stringify(...)` placed directly into a `dangerouslySetInnerHTML`
// `__html` value. `JSON.stringify` does NOT HTML-escape, so a value containing
// `</script>`, `<`, or U+2028/U+2029 breaks out of the markup — the classic
// SSR data-hydration XSS. `dangerous-html-sink` misses this because the raw
// `JSON.stringify(data)` value does not look "tainted" to it.
const JSON_STRINGIFY_IN_DANGEROUS_HTML =
  /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:[\s\S]{0,300}?\bJSON\.stringify\s*\(/;

// `JSON.stringify(...)` interpolated or concatenated into inline `<script>`
// markup (`<script>window.__DATA__ = ${JSON.stringify(state)}</script>`). The
// negative lookahead keeps the match inside one script element so an unrelated
// later `JSON.stringify` after a closing tag does not false-match.
const JSON_STRINGIFY_IN_SCRIPT_MARKUP =
  /<script\b[^>]*>(?:(?!<\/script>)[\s\S]){0,300}?\bJSON\.stringify\s*\(/i;

// HTML-safe serializers and explicit `<`-escaping make the embed safe.
const HTML_SAFE_JSON_PATTERN =
  /serialize-javascript|\bdevalue\b|\bsuperjson\b|\bjsesc\b|html-?escape|\\u003[cC]|escapeHtml|escapeJSON|escapeJson/i;

export const unsafeJsonInHtml = defineRule({
  id: "unsafe-json-in-html",
  title: "Unescaped JSON in HTML or script sink",
  severity: "warn",
  recommendation:
    'JSON.stringify does not HTML-escape, so a `</script>` (or `<`) in the data breaks out and becomes XSS. Use an HTML-safe serializer (serialize-javascript, devalue) or escape `<`, `>`, and `&`, or pass data via a JSON `<script type="application/json">` read with JSON.parse.',
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern: [JSON_STRINGIFY_IN_DANGEROUS_HTML, JSON_STRINGIFY_IN_SCRIPT_MARKUP],
    suppressWhen: HTML_SAFE_JSON_PATTERN,
    message:
      "JSON.stringify is embedded in HTML/script markup without HTML-escaping; data containing `</script>` or `<` breaks out and becomes XSS.",
  }),
});
