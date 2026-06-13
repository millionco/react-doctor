import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { escapeRegExp } from "./utils/escape-reg-exp.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";

const DANGEROUS_HTML_PATTERN = /dangerouslySetInnerHTML|\.innerHTML\s*[+]?=(?!=)/;

const HTML_VALUE_START_PATTERN = /(?:__html\s*:|\.innerHTML\s*[+]?=(?!=))\s*([\s\S]*)/;

const HTML_TAINT_PATTERN =
  /searchParams|query|params|request|req\.|response\.|result\.|data\.|await|fetch|props\.|children|content|html|body|text|message/i;

// A trailing line comment (`innerHTML = "" // clear`) must not defeat the
// literal/constant exemptions: without tolerating it the value never matches,
// the scan window bleeds into the next statement, and the taint check fires on
// unrelated tokens there (e.g. a following `content` variable).
const STRING_LITERAL_VALUE_PATTERN =
  /^(?:["'][^"']*["']|`[^`$]*`)\s*(?:\/\/[^\n]*)?\s*(?:[;,})\n]|$)/;

const MODULE_CONSTANT_VALUE_PATTERN = /^[A-Z][A-Z0-9_]*\s*(?:\/\/[^\n]*)?\s*(?:[;,})\n]|$)/;

// `node.innerHTML = other.outerHTML` / `= other.innerHTML` (optionally with a
// `.replace`/`.trim` transform) re-serializes content already in the DOM — the
// value never left the document, so it is not an injection boundary. A `+`
// concatenation could splice in fresh input, so those are still judged.
const DOM_CONTENT_SOURCE_VALUE_PATTERN = /^[\w$]+(?:\.[\w$]+)*\.(?:inner|outer)HTML\b/;

// `(?<!un)safe` catches sanitized-by-convention names (markdownToSafeHTML,
// descriptionAsSafeHtml) without matching `unsafeHtml`. `escape*`/`encode*`
// cover HTML entity encoders (`escapeHtml`, `encodeNonAsciiHTML`) whose output
// is escaped text, not live markup.
const SANITIZER_PATTERN =
  /\b(?:DOMPurify|sanitize\w*|purify|(?:escape|encode)[A-Z]\w*|insane|xss)\b|(?<!un)safe|(?<!un)saniti[sz]/i;

// A bare-identifier value sanitized at its definition site
// (`const clean = DOMPurify.sanitize(md)` then `__html: clean`). The sink only
// sees the identifier, so the source assignment is checked across the file.
const SANITIZED_ASSIGNMENT_PATTERN =
  /=\s*[^\n;]*\b(?:DOMPurify\b|sanitize\w*\s*\(|purify\w*\s*\()/i;

// Values interpolating only deploy-time config (analytics snippets built
// from NEXT_PUBLIC_* ids) are developer-controlled, not user input.
const ENV_CONFIG_VALUE_PATTERN = /process\.env/;

const I18N_VALUE_PATTERN = /\b(?:t|i18n|translate|formatMessage|intl)\s*[.(]/;

// Output of escaping serializers (hast `toHtml`, KaTeX, Shiki, React's
// renderToStaticMarkup) is markup the library generated, not user HTML.
// `render*HTML(...)` covers in-house code/diff serializers (pierre's
// `renderPartialHTML`) alongside React's `renderToString` family — markup the
// renderer generated, not user HTML.
const ESCAPING_SERIALIZER_CALL_PATTERN =
  /^(?:[\w$.]+\.)?(?:toHtml|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast)\s*\(/;

const ESCAPING_SERIALIZER_LIBRARY_PATTERN =
  /\bkatex\b|\bshiki\b|\bhljs\b|\bprism\b|codeToHtml\s*\(|renderToStaticMarkup\s*\(|\bhast-util-to-html\b|renderHtmlFromRichText\b/i;

const BARE_IDENTIFIER_VALUE_PATTERN = /^[\w$]+\s*(?:[;,})\n]|$)/;

// Highlighter/serializer output is routinely stored on an object before the
// sink (`highlightedFiles[0].darkHtml`), so the serializer-library exemption
// must accept member/index access, not only a bare identifier.
const MEMBER_OR_INDEX_ACCESS_VALUE_PATTERN = /^[\w$]+(?:\.[\w$]+|\[[^\]]*\])+\s*(?:[;,})\n]|$)/;

// `<style dangerouslySetInnerHTML={{ __html: ... }}>` injects CSS text, not
// executable markup — the critical-CSS idiom, and at worst CSS injection.
const STYLE_TAG_BEFORE_SINK_PATTERN = /<style\b[^<>]*$/;

const STYLE_TAG_LOOKBEHIND_LINES = 5;

// HTML email bodies are rendered by mail clients, which strip script and
// event handlers — the browser-XSS model this rule encodes does not apply.
// Also exempt email components by filename (e.g. RawHtml.tsx or *Email.tsx)
// even when scan rootDir is a monorepo subpackage like packages/emails (so
// the relativePath never contains an "emails/" segment).
const EMAIL_TEMPLATE_PATH_PATTERN =
  /(?:^|\/)emails?(?:\/|$)|email[-_.]templates?(?:\/|$)|RawHtml|[A-Za-z]*[Ee]mail[A-Za-z]*\.(?:t|j)sx?/i;

const INNERHTML_TARGET_PATTERN = /(?:^|[^\w$.])([\w$]+(?:\.[\w$]+)*)\.innerHTML\s*[+]?=(?!=)/;

// DOM methods that splice a node into a live tree. If a scratch node reaches
// one of these — or is returned as a node — its parsed HTML can hit the live
// document, so it is no longer an inert parse target.
const LIVE_DOM_ATTACH_PATTERN =
  /\b(?:appendChild|append|prepend|before|after|replaceWith|replaceChild|replaceChildren|insertBefore|insertAdjacentElement)\s*\(/;

const VALUE_LOOKAHEAD_LINES = 4;
const VALUE_EXPRESSION_MAX_CHARS = 300;

// Inline theme-init <script> templates routinely span dozens of lines.
const STATIC_TEMPLATE_LOOKAHEAD_LINES = 60;
const STATIC_TEMPLATE_MAX_CHARS = 5000;

// The static text of a template literal cannot be injection; only the
// `${...}` interpolations carry data. Judging the whole body flags inline
// theme-init scripts because their static code mentions `query` or `text`.
// Returns null when the value is not a template that closes in the window.
const getTemplateInterpolations = (valueTail: string): string | null => {
  if (!valueTail.startsWith("`")) return null;
  const closingBacktickIndex = valueTail.indexOf("`", 1);
  if (closingBacktickIndex < 0 || closingBacktickIndex > STATIC_TEMPLATE_MAX_CHARS) return null;
  const templateBody = valueTail.slice(1, closingBacktickIndex);
  const interpolations = templateBody.match(/\$\{[^}]*\}/g);
  return interpolations === null ? "" : interpolations.join(" ");
};

// A sink target is inert when its parsed HTML can never reach the live
// document. Three idioms qualify:
//   1. `<template>` content — inert by spec (never rendered, scripts do not run).
//   2. a `createHTMLDocument()` document — no browsing context, so assigning
//      innerHTML never executes scripts and the document is never the live page.
//   3. a detached `createElement` node used only to parse — read back as text or
//      queried — and never attached to a live tree nor returned as a node.
// The variable name is specific enough to scan the whole file, which also
// catches scratch nodes parsed across a loop (the second write in a reuse loop
// sits far from its `createElement`).
const isInertParseTarget = (target: string, fileContent: string): boolean => {
  const escapedTarget = escapeRegExp(target);
  const rootIdentifier = target.split(".")[0] ?? target;
  const escapedRoot = escapeRegExp(rootIdentifier);

  const templateElementPattern = new RegExp(
    `${escapedTarget}\\s*=\\s*document\\.createElement\\(\\s*["'\`]template["'\`]`,
  );
  if (templateElementPattern.test(fileContent)) return true;

  // A `<style>` element's innerHTML is CSS text, not executable markup — the
  // critical-CSS idiom via the DOM API (`createElement('style')`), the
  // counterpart of the `<style dangerouslySetInnerHTML>` JSX exemption.
  const styleElementPattern = new RegExp(
    `${escapedRoot}\\s*=\\s*[^\\n;]*\\bcreateElement\\(\\s*["'\`]style["'\`]`,
  );
  if (styleElementPattern.test(fileContent)) return true;

  const isolatedDocumentPattern = new RegExp(
    `${escapedRoot}\\s*=\\s*[^\\n;]*\\bcreateHTMLDocument\\s*\\(`,
  );
  if (isolatedDocumentPattern.test(fileContent)) return true;

  const createElementPattern = new RegExp(`${escapedRoot}\\s*=\\s*[^\\n;]*\\bcreateElement\\s*\\(`);
  if (!createElementPattern.test(fileContent)) return false;

  const attachedToLiveTreePattern = new RegExp(
    `${LIVE_DOM_ATTACH_PATTERN.source}[^)]*\\b${escapedRoot}\\b`,
  );
  const returnedAsNodePattern = new RegExp(
    `\\breturn\\b[^\\n]*\\b${escapedRoot}\\b(?!\\s*\\.\\s*(?:textContent|innerText|innerHTML|outerHTML))`,
  );
  if (attachedToLiveTreePattern.test(fileContent) || returnedAsNodePattern.test(fileContent)) {
    return false;
  }

  const scratchReadPattern = new RegExp(
    `\\b${escapedRoot}\\.(?:textContent|innerText|querySelector|querySelectorAll|children|childNodes)\\b`,
  );
  return scratchReadPattern.test(fileContent);
};

export const dangerousHtmlSink = defineRule({
  id: "dangerous-html-sink",
  title: "HTML injection sink with dynamic content",
  severity: "warn",
  recommendation:
    "Prefer rendering structured React nodes. If HTML is required, sanitize with a well-reviewed sanitizer and keep the trust boundary close to the sink.",
  scan: (file) => {
    // Generated/minified bundles are build output, not human-authored source:
    // you do not fix an XSS sink there, and minified one-liners (inline SVG
    // icon fonts) make the line heuristics misfire.
    if (file.isGeneratedBundle) return [];
    if (!isProductionSourcePath(file.relativePath)) return [];
    if (EMAIL_TEMPLATE_PATH_PATTERN.test(file.relativePath)) return [];
    if (!DANGEROUS_HTML_PATTERN.test(file.content)) return [];

    const findings: ScanFinding[] = [];
    const lines = file.content.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      if (!DANGEROUS_HTML_PATTERN.test(line)) continue;

      // Skip sinks inside a comment — commented-out code never runs. A leading
      // `//` (not part of a `://` URL) or a block-comment line (`*` / `/*`).
      const textBeforeSinkOnLine = line.slice(0, line.search(DANGEROUS_HTML_PATTERN));
      if (/(?:^|[^:])\/\//.test(textBeforeSinkOnLine) || /^\s*[/*]/.test(line)) continue;

      // Judge only the value expression handed to the sink — judging the
      // surrounding window flags any component that mentions text/content/data.
      const sinkWindow = lines.slice(lineIndex, lineIndex + 1 + VALUE_LOOKAHEAD_LINES).join("\n");
      const valueMatch = HTML_VALUE_START_PATTERN.exec(sinkWindow);
      if (valueMatch === null) continue;
      const fullValueTail = (valueMatch[1] ?? "").trimStart();
      const valueTail = fullValueTail.slice(0, VALUE_EXPRESSION_MAX_CHARS);
      // Stop at the statement/prop boundary so code after the sink is not judged.
      const terminatorIndex = valueTail.search(/[;}]/);
      const valueExpression =
        terminatorIndex >= 0 ? valueTail.slice(0, terminatorIndex + 1) : valueTail;

      if (STRING_LITERAL_VALUE_PATTERN.test(valueExpression)) continue;
      if (MODULE_CONSTANT_VALUE_PATTERN.test(valueExpression)) continue;
      if (
        DOM_CONTENT_SOURCE_VALUE_PATTERN.test(valueExpression) &&
        !valueExpression.includes("+")
      ) {
        continue;
      }

      const longValueTail = HTML_VALUE_START_PATTERN.exec(
        lines.slice(lineIndex, lineIndex + 1 + STATIC_TEMPLATE_LOOKAHEAD_LINES).join("\n"),
      )?.[1]?.trimStart();
      const templateInterpolations = getTemplateInterpolations(longValueTail ?? fullValueTail);
      if (templateInterpolations === "") continue;
      const judgedExpression = templateInterpolations ?? valueExpression;

      if (SANITIZER_PATTERN.test(judgedExpression)) continue;
      if (ENV_CONFIG_VALUE_PATTERN.test(judgedExpression)) continue;
      if (I18N_VALUE_PATTERN.test(judgedExpression)) continue;
      if (!HTML_TAINT_PATTERN.test(judgedExpression)) continue;
      if (ESCAPING_SERIALIZER_CALL_PATTERN.test(valueExpression)) continue;
      if (
        (BARE_IDENTIFIER_VALUE_PATTERN.test(valueExpression) ||
          MEMBER_OR_INDEX_ACCESS_VALUE_PATTERN.test(valueExpression)) &&
        ESCAPING_SERIALIZER_LIBRARY_PATTERN.test(file.content)
      ) {
        continue;
      }
      if (BARE_IDENTIFIER_VALUE_PATTERN.test(valueExpression)) {
        const bareIdentifierName = valueExpression.match(/^[\w$]+/)?.[0];
        if (
          bareIdentifierName !== undefined &&
          new RegExp(
            `\\b${escapeRegExp(bareIdentifierName)}\\b\\s*${SANITIZED_ASSIGNMENT_PATTERN.source}`,
            "i",
          ).test(file.content)
        ) {
          continue;
        }
      }
      const sinkTargetMatch = INNERHTML_TARGET_PATTERN.exec(line);
      if (
        sinkTargetMatch?.[1] !== undefined &&
        isInertParseTarget(sinkTargetMatch[1], file.content)
      ) {
        continue;
      }
      const textBeforeSink = lines
        .slice(Math.max(0, lineIndex - STYLE_TAG_LOOKBEHIND_LINES), lineIndex + 1)
        .join("\n")
        .slice(0, -line.length + line.search(DANGEROUS_HTML_PATTERN));
      if (STYLE_TAG_BEFORE_SINK_PATTERN.test(textBeforeSink)) continue;

      findings.push({
        message:
          "HTML is injected from a dynamic-looking source, which can become XSS if the value is user-controlled or unsanitized.",
        line: lineIndex + 1,
        column: line.search(/\S/) + 1,
      });
    }
    return findings;
  },
});
