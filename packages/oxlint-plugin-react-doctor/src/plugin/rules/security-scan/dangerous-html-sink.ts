import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { escapeRegExp } from "./utils/escape-reg-exp.js";
import { findMatchingBracket } from "./utils/find-matching-bracket.js";
import { collectKatexSinkProofRanges } from "./utils/get-katex-sink-proof-ranges.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";

// HTML-injection sinks: React's `dangerouslySetInnerHTML`, the DOM
// `innerHTML`/`outerHTML` assignments (dot or bracket notation —
// `el["innerHTML"] = x` is the same sink), `insertAdjacentHTML(position, html)`,
// `document.write(ln)(html)`, `Range.createContextualFragment(html)`, and the
// explicitly-unsafe `Element.setHTMLUnsafe(html)` (the sanitizing `setHTML` is
// deliberately not a sink).
const DANGEROUS_HTML_PATTERN =
  /dangerouslySetInnerHTML|(?:\.(?:inner|outer)HTML|\[\s*["'](?:inner|outer)HTML["']\s*\])\s*[+]?=(?!=)|\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\.(?:createContextualFragment|setHTMLUnsafe)\s*\(/;

// Captures the value handed to the sink. For `insertAdjacentHTML` the value is
// the second argument (after the position), so the position arg is skipped. The
// leading `.` keeps it a method call, not a `function insertAdjacentHTML(` decl.
const HTML_VALUE_START_PATTERN =
  /(?:__html\s*:|(?:\.(?:inner|outer)HTML|\[\s*["'](?:inner|outer)HTML["']\s*\])\s*[+]?=(?!=)|\.insertAdjacentHTML\s*\(\s*[^,]*,|\bdocument\.write(?:ln)?\s*\(|\.(?:createContextualFragment|setHTMLUnsafe)\s*\()\s*([\s\S]*)/;

// Dynamic-looking sources. Beyond request/props/state data, this covers the
// classic OWASP DOM-XSS sources (`location.hash`/`.search`/`.href`,
// `document.cookie`/`.referrer`, `window.name`, web/session storage,
// `URLSearchParams`) — attacker-controllable channels that must be flagged.
const HTML_TAINT_PATTERN =
  /searchParams|query|params|request|req\.|response\.|result\.|data\.|await|fetch|props\.|children|content|html|body|text|message|markup|\blocation\b|document\.cookie|\breferrer\b|\blocalStorage\b|\bsessionStorage\b|URLSearchParams|window\.name/i;

// A trailing line comment (`innerHTML = "" // clear`) must not defeat the
// literal/constant exemptions: without tolerating it the value never matches,
// the scan window bleeds into the next statement, and the taint check fires on
// unrelated tokens there (e.g. a following `content` variable).
// Escape-aware bodies (`"It\"s"`, `'a "b"'`) so a quote of the other kind — or
// an escaped one — inside the literal doesn't end the match early and drop the
// exemption.
const STRING_LITERAL_VALUE_PATTERN =
  /^(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`[^`$]*`)\s*(?:\/\/[^\n]*)?\s*(?:[;,})\n]|$)/;

const MODULE_CONSTANT_VALUE_PATTERN = /^[A-Z][A-Z0-9_]*\s*(?:\/\/[^\n]*)?\s*(?:[;,})\n]|$)/;

// `node.innerHTML = other.outerHTML` / `= other.innerHTML` (optionally with a
// `.replace`/`.trim` transform) re-serializes content already in the DOM — the
// value never left the document, so it is not an injection boundary. A `+`
// concatenation could splice in fresh input, so those are still judged.
const DOM_CONTENT_SOURCE_VALUE_PATTERN = /^[\w$]+(?:\??\.[\w$]+)*\??\.(?:inner|outer)HTML\b/;

// `(?<!un)safe` catches sanitized-by-convention names (markdownToSafeHTML,
// descriptionAsSafeHtml) without matching `unsafeHtml`. The `escape`/`encode`
// arm is scoped to HTML entity encoders (`escapeHtml`, `encodeNonAsciiHTML`) so
// it does not exempt unrelated encoders (`encodeURIComponent`, `escapeRegExp`).
const SANITIZER_PATTERN =
  /\b(?:DOMPurify|sanitize\w*|purify|(?:escape|encode)[A-Za-z]*(?:Html|HTML|Entit\w*)|insane|xss)\b|(?<!un)safe|(?<!un)saniti[sz]/i;

// A bare-identifier value sanitized at its definition site
// (`const clean = DOMPurify.sanitize(md)` then `__html: clean`). The sink only
// sees the identifier, so the source assignment is checked across the file.
// `[:=]` accepts property-style provenance (`{ html: DOMPurify.sanitize(md) }`
// routed through state) alongside plain assignments.
const SANITIZED_ASSIGNMENT_PATTERN =
  /[:=]\s*[^\n;]*\b(?:DOMPurify\b|sanitize\w*\s*\(|purify\w*\s*\()/i;

// A bare-identifier value captured from a DOM node's own serialized content
// (`const original = button.innerHTML; … button.innerHTML = original`). The
// restored markup never left the document, so it is not new input. Only a pure
// read (no concatenation) qualifies.
const DOM_CONTENT_ASSIGNMENT_PATTERN = /=\s*[\w$.?[\]]*\.(?:inner|outer)HTML\s*(?:[;,)\n]|$)/;

// Values interpolating only deploy-time config (analytics snippets built
// from NEXT_PUBLIC_* ids) are developer-controlled, not user input.
const ENV_CONFIG_VALUE_PATTERN = /process\.env/;

const I18N_VALUE_PATTERN = /\b(?:t|i18n|translate|formatMessage|intl)\s*[.(]/;

// Output of escaping serializers (hast `toHtml`, KaTeX, Shiki, React's
// renderToStaticMarkup) is markup the library generated, not user HTML.
// `render*HTML(...)` covers in-house code/diff serializers (pierre's
// `renderPartialHTML`) alongside React's `renderToString` family — markup the
// renderer generated, not user HTML. Used when the serializer call IS the value.
const ESCAPING_SERIALIZER_CALL_PATTERN =
  /^(?:[\w$.]+\.)?(?:toHtml|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast|highlight[A-Za-z]*)\s*\(/;

// Syntax/code highlighters (Shiki, Prism, highlight.js, …) HTML-escape their
// input and wrap tokens in spans — the output is generated markup. A value that
// is highlighter output is commonly fed through React state
// (`const [highlightedHtml, setHighlightedHtml] = useState(); … setHighlightedHtml(await codeToHtml(code))`),
// so the data-flow assignment check misses it. Exempt a `highlight`-named value
// when the file actually uses a highlighter library (keeps the trust link).
const HIGHLIGHTER_LIBRARY_PATTERN =
  /\b(?:shiki|prism|hljs|highlightjs|getHighlighter|codeToHtml|codeToHast|refractor|lowlight|starry-night)\b|highlight\.js/i;

// When the value is an identifier/member access, exempt it only if that
// identifier is assigned from an escaping serializer in the file (`const html =
// katex.renderToString(...)`, `const r = hljs.highlightAuto(...)`). Keying off a
// bare file-wide library keyword would exempt any sink in a file that merely
// imports a highlighter — checking the assignment keeps the trust link.
const SERIALIZER_ASSIGNMENT_PATTERN =
  /[:=]\s*[^\n;]*(?:\b(?:katex|shiki|hljs|prism|mermaid)\b|hast-util-to-html|renderHtmlFromRichText|(?:toHtml|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast)\s*\()/i;

const SERIALIZER_CALL_PROVENANCE_PATTERN =
  /\b(?:(?:katex|shiki|hljs|prism|mermaid|highlighter)[\w$]*\.(?:render\w*|highlight\w*|codeTo(?:Html|Hast))|(?:toHtml|render(?:Html|HTML)[A-Za-z]*|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast|highlight[A-Za-z]*))\s*\(/i;

const BARE_IDENTIFIER_VALUE_PATTERN = /^[\w$]+\s*(?:[;,})\n]|$)/;

// `lineHtml || " "` / `html ?? ""` — an identifier with a string-literal
// fallback is still identifier-shaped for provenance checks.
const IDENTIFIER_WITH_LITERAL_FALLBACK_PATTERN =
  /^[\w$]+\s*(?:\|\||\?\?)\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*(?:[;,})\n]|$)/;

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
// Only the PLURAL `emails/` directory (the react-email convention) is a
// template dir; a singular `email/` directory in a webmail app holds
// browser UI (composer, viewer) whose sinks render into the live page.
const EMAIL_TEMPLATE_PATH_PATTERN =
  /(?:^|\/)emails(?:\/|$)|email[-_.]templates?(?:\/|$)|RawHtml|[A-Za-z]*[Ee]mail[A-Za-z]*\.(?:t|j)sx?/i;

// Files under hidden tool directories (`.dumi/theme/`, `.storybook/`) are
// docs-site/tooling themes rendering repository-authored content, not
// production app source. (`.next/`, `.yarn/` are already generated paths.)
const HIDDEN_TOOLING_DIRECTORY_PATTERN = /(?:^|\/)\.[\w-]+\//;

// A file explicitly named after sanitizing (`sanitized-html.tsx`,
// `SanitizedHTML.tsx`) is a deliberate render-pre-sanitized-HTML wrapper whose
// callers hold the sanitizer — the audited-by-design idiom. `(?<!un)` keeps
// `unsanitized-html.tsx` firing.
const SANITIZER_WRAPPER_PATH_PATTERN = /(?<!un)saniti[sz]e?d?[\w-]*\.[cm]?[jt]sx?$/i;

const INNERHTML_TARGET_PATTERN =
  /(?:^|[^\w$.])([\w$]+(?:\.[\w$]+)*)(?:(?:\.(?:inner|outer)HTML|\[\s*["'](?:inner|outer)HTML["']\s*\])\s*[+]?=(?!=)|\.insertAdjacentHTML\s*\()/;

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

// Returns the initializer text of the identifier's `const`/`let`/`var`
// declaration (bounded window), or null when the file never declares it.
const getIdentifierDeclarationInitializer = (
  identifier: string,
  sinkIndex: number,
  fileContent: string,
): string | null => {
  const declaration = findVisibleIdentifierDeclaration(identifier, sinkIndex, fileContent);
  if (declaration === null) return null;
  return fileContent.slice(
    declaration.initializerStartIndex,
    declaration.initializerStartIndex + STATIC_TEMPLATE_MAX_CHARS,
  );
};

// `const html = '<span>…</span>' + '…' + '…';` — an initializer that is only
// string literals joined by `+` is static markup, the multi-line counterpart
// of the single-literal exemption.
const isPureStringLiteralConcat = (initializerText: string): boolean => {
  if (!/^["']/.test(initializerText)) return false;
  const withoutLiterals = initializerText.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, "");
  const statementEndIndex = withoutLiterals.search(/[;,})\]]/);
  const betweenLiterals =
    statementEndIndex >= 0 ? withoutLiterals.slice(0, statementEndIndex) : withoutLiterals;
  return /^[\s+]*$/.test(betweenLiterals);
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
  // Every inert idiom below requires one of these call names somewhere in the
  // file — without them no pattern can match, so skip all regex builds/scans.
  const fileHasCreateElement = fileContent.includes("createElement");
  const fileHasIsolatedDocument = fileContent.includes("createHTMLDocument");
  if (!fileHasCreateElement && !fileHasIsolatedDocument) return false;

  const escapedTarget = escapeRegExp(target);
  const rootIdentifier = target.split(".")[0] ?? target;
  const escapedRoot = escapeRegExp(rootIdentifier);

  // Whole-file matching means a same-named binding elsewhere can leak this
  // exemption. If the root is ever bound to a live DOM node, the sink can hit
  // the live document — never treat it as inert (conservative on collision).
  const liveDomSourcePattern = new RegExp(
    `\\b${escapedRoot}\\s*=\\s*[^\\n;]*(?:getElementById|querySelector|getElementsBy|\\.current\\b|document\\.(?:body|head|documentElement))`,
  );
  if (liveDomSourcePattern.test(fileContent)) return false;

  if (fileHasCreateElement) {
    const templateElementPattern = new RegExp(
      `${escapedTarget}\\s*=\\s*document\\.createElement\\(\\s*["'\`]template["'\`]`,
    );
    if (templateElementPattern.test(fileContent)) return true;

    // A `<style>` element's innerHTML is CSS text (the critical-CSS idiom via the
    // DOM API, counterpart of the `<style dangerouslySetInnerHTML>` JSX exemption);
    // a `<textarea>`'s is RCDATA — scripts never execute — which is the HTML-entity
    // decode idiom (`textarea.innerHTML = x; return textarea.value`). Neither is
    // executable markup.
    const inertElementPattern = new RegExp(
      `${escapedRoot}\\s*=\\s*[^\\n;]*\\bcreateElement\\(\\s*["'\`](?:style|textarea)["'\`]`,
    );
    if (inertElementPattern.test(fileContent)) return true;
  }

  if (fileHasIsolatedDocument) {
    const isolatedDocumentPattern = new RegExp(
      `${escapedRoot}\\s*=\\s*[^\\n;]*\\bcreateHTMLDocument\\s*\\(`,
    );
    if (isolatedDocumentPattern.test(fileContent)) return true;
  }

  if (!fileHasCreateElement) return false;
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

// Split a value expression on top-level `+` operators, ignoring `+` inside
// parentheses, brackets, braces, or string/template literals.
const splitTopLevelByPlus = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let openQuote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (openQuote !== null) {
      current += character;
      if (character === openQuote && text[index - 1] !== "\\") openQuote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      openQuote = character;
      current += character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    if (character === "+" && depth === 0 && text[index - 1] !== "+" && text[index + 1] !== "+") {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
};

// `a.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML`
// re-serializes already-rendered DOM on BOTH sides of the concat — no fresh
// input is spliced in — so it is no more dangerous than a single DOM read.
const isAllOperandsDomContentConcat = (valueExpression: string): boolean => {
  const body = valueExpression.replace(/[;}]\s*$/, "").trim();
  if (!body.includes("+")) return false;
  const operands = splitTopLevelByPlus(body)
    .map((operand) => operand.trim())
    .filter((operand) => operand.length > 0);
  if (operands.length < 2) return false;
  return operands.every((operand) => {
    const withoutCast = operand.replace(/\(\s*([\w$]+(?:\??\.[\w$]+)*)\s+as\s+[^)]*\)/g, "$1");
    if (!DOM_CONTENT_SOURCE_VALUE_PATTERN.test(withoutCast)) return false;
    return !HTML_TAINT_PATTERN.test(withoutCast.replace(DOM_CONTENT_SOURCE_VALUE_PATTERN, ""));
  });
};

const findMatchingBraceIndex = (fileContent: string, openingBraceIndex: number): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openingBraceIndex; index < fileContent.length; index += 1) {
    const character = fileContent[index];
    if (quote !== null) {
      if (character === quote && fileContent[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return fileContent.length;
};

const findContainingBlockEndIndex = (fileContent: string, targetIndex: number): number => {
  const openingBraceIndexes: number[] = [];
  let quote: string | null = null;
  let isLineComment = false;
  let isBlockComment = false;
  for (let index = 0; index < targetIndex; index += 1) {
    const character = fileContent[index];
    const nextCharacter = fileContent[index + 1];
    if (isLineComment) {
      if (character === "\n") isLineComment = false;
      continue;
    }
    if (isBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        isBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (character === quote && fileContent[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      isLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      isBlockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") openingBraceIndexes.push(index);
    if (character === "}") openingBraceIndexes.pop();
  }
  const openingBraceIndex = openingBraceIndexes.at(-1);
  return openingBraceIndex === undefined
    ? fileContent.length
    : findMatchingBraceIndex(fileContent, openingBraceIndex);
};

interface VisibleIdentifierDeclaration {
  readonly declarationIndex: number;
  readonly initializer: string;
  readonly initializerStartIndex: number;
  readonly isImmutable: boolean;
}

const findVisibleIdentifierDeclaration = (
  identifier: string,
  sinkIndex: number,
  fileContent: string,
): VisibleIdentifierDeclaration | null => {
  const initializerPattern = new RegExp(
    `(const|let|var)\\s+${escapeRegExp(identifier)}\\s*(?::[^=\\n]*)?=\\s*([^;\\n]+)`,
    "g",
  );
  let nearestDeclaration: VisibleIdentifierDeclaration | null = null;
  let nearestDeclarationIndex = -1;
  for (const match of fileContent.matchAll(initializerPattern)) {
    const declarationIndex = match.index;
    if (
      declarationIndex === undefined ||
      declarationIndex >= sinkIndex ||
      declarationIndex <= nearestDeclarationIndex ||
      findContainingBlockEndIndex(fileContent, declarationIndex) < sinkIndex
    ) {
      continue;
    }
    nearestDeclarationIndex = declarationIndex;
    const initializer = match[2];
    if (initializer === undefined) continue;
    nearestDeclaration = {
      declarationIndex,
      initializer,
      initializerStartIndex: declarationIndex + match[0].length - initializer.length,
      isImmutable: match[1] === "const",
    };
  }
  return nearestDeclaration;
};

const isDeclarationStable = (
  identifier: string,
  declaration: VisibleIdentifierDeclaration,
  usageIndex: number,
  fileContent: string,
): boolean => {
  if (declaration.isImmutable) return true;
  const textAfterInitializer = fileContent.slice(
    declaration.initializerStartIndex + declaration.initializer.length,
    usageIndex,
  );
  const reassignmentPattern = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(identifier)}\\s*=(?!=)`);
  return !reassignmentPattern.test(textAfterInitializer);
};

const isTrustedHighlighterValue = (
  valueExpression: string,
  fileContent: string,
  sinkIndex: number,
): boolean => {
  if (!/highlight/i.test(valueExpression)) return false;
  const identifier = valueExpression.match(/^([\w$]+)/)?.[1];
  if (identifier === undefined) return false;
  const declaration = findVisibleIdentifierDeclaration(identifier, sinkIndex, fileContent);
  if (declaration !== null) {
    return (
      isDeclarationStable(identifier, declaration, sinkIndex, fileContent) &&
      SERIALIZER_CALL_PROVENANCE_PATTERN.test(declaration.initializer)
    );
  }
  return /highlighted/i.test(valueExpression) || HIGHLIGHTER_LIBRARY_PATTERN.test(fileContent);
};

const isExplicitlyTrustedHtmlValue = (
  valueExpression: string,
  fileContent: string,
  sinkIndex: number,
  visitedIdentifiers: Set<string> = new Set(),
): boolean => {
  const trimmedExpression = valueExpression.trim();
  const concatenatedParts = splitTopLevelByPlus(trimmedExpression);
  if (concatenatedParts.length > 1) {
    return concatenatedParts.every((part) =>
      isExplicitlyTrustedHtmlValue(part, fileContent, sinkIndex, visitedIdentifiers),
    );
  }
  const interpolationParts = [...trimmedExpression.matchAll(/\$\{([^}]*)\}/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  if (interpolationParts.length > 1) {
    return interpolationParts.every((part) =>
      isExplicitlyTrustedHtmlValue(part, fileContent, sinkIndex, visitedIdentifiers),
    );
  }
  const identifier = trimmedExpression.match(
    /^([\w$]+)(?:(?:\??\.[\w$]+)|(?:\[\s*(?:"[^"\n]*"|'[^'\n]*'|\d+)\s*\]))*$/,
  )?.[1];
  if (identifier && !visitedIdentifiers.has(identifier)) {
    const declaration = findVisibleIdentifierDeclaration(identifier, sinkIndex, fileContent);
    if (declaration && isDeclarationStable(identifier, declaration, sinkIndex, fileContent)) {
      const nextVisitedIdentifiers = new Set(visitedIdentifiers);
      nextVisitedIdentifiers.add(identifier);
      return isExplicitlyTrustedHtmlValue(
        declaration.initializer,
        fileContent,
        declaration.initializerStartIndex,
        nextVisitedIdentifiers,
      );
    }
  }
  if (
    STRING_LITERAL_VALUE_PATTERN.test(`${trimmedExpression};`) ||
    MODULE_CONSTANT_VALUE_PATTERN.test(`${trimmedExpression};`) ||
    SANITIZER_PATTERN.test(trimmedExpression) ||
    ENV_CONFIG_VALUE_PATTERN.test(trimmedExpression) ||
    I18N_VALUE_PATTERN.test(trimmedExpression) ||
    ESCAPING_SERIALIZER_CALL_PATTERN.test(trimmedExpression) ||
    isTrustedHighlighterValue(trimmedExpression, fileContent, sinkIndex)
  ) {
    return true;
  }
  return false;
};

const doesExpressionAliasIdentifier = (
  expression: string,
  targetIdentifier: string,
  expressionIndex: number,
  fileContent: string,
  visitedIdentifiers: Set<string> = new Set(),
): boolean => {
  const identifier = expression.trim().match(/^([\w$]+)$/)?.[1];
  if (!identifier) return false;
  if (identifier === targetIdentifier) return true;
  if (visitedIdentifiers.has(identifier)) return false;
  const declaration = findVisibleIdentifierDeclaration(identifier, expressionIndex, fileContent);
  if (!declaration?.isImmutable) return false;
  const nextVisitedIdentifiers = new Set(visitedIdentifiers);
  nextVisitedIdentifiers.add(identifier);
  return doesExpressionAliasIdentifier(
    declaration.initializer,
    targetIdentifier,
    declaration.initializerStartIndex,
    fileContent,
    nextVisitedIdentifiers,
  );
};

interface FunctionParameterSource {
  readonly bodyEndIndex: number;
  readonly declarationNameIndex: number;
  readonly functionName: string;
  readonly parameterIndex: number;
}

const findContainingFunctionParameterSource = (
  identifier: string,
  sinkIndex: number,
  fileContent: string,
): FunctionParameterSource | null => {
  const patterns = [
    /function\s+([\w$]+)\s*\(([^)]*)\)\s*\{/g,
    /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g,
  ];
  let closestSource: FunctionParameterSource | null = null;
  let closestStartIndex = -1;
  for (const pattern of patterns) {
    for (const match of fileContent.matchAll(pattern)) {
      const matchIndex = match.index;
      if (matchIndex === undefined || matchIndex >= sinkIndex || matchIndex < closestStartIndex) {
        continue;
      }
      const openingBraceIndex = matchIndex + match[0].lastIndexOf("{");
      const bodyEndIndex = findMatchingBraceIndex(fileContent, openingBraceIndex);
      if (bodyEndIndex < sinkIndex) continue;
      const parameterIndex = (match[2] ?? "")
        .split(",")
        .findIndex(
          (parameter) => parameter.trim().match(/^(?:\.\.\.)?([\w$]+)/)?.[1] === identifier,
        );
      if (parameterIndex < 0) continue;
      closestStartIndex = matchIndex;
      const functionName = match[1] ?? "";
      closestSource = {
        bodyEndIndex,
        declarationNameIndex: matchIndex + match[0].indexOf(functionName),
        functionName,
        parameterIndex,
      };
    }
  }
  return closestSource;
};

const splitTopLevelArguments = (argumentText: string): string[] => {
  const argumentsList: string[] = [];
  let startIndex = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < argumentText.length; index += 1) {
    const character = argumentText[index];
    if (quote !== null) {
      if (character === quote && argumentText[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      argumentsList.push(argumentText.slice(startIndex, index).trim());
      startIndex = index + 1;
    }
  }
  argumentsList.push(argumentText.slice(startIndex).trim());
  return argumentsList;
};

const isBackedByFunctionParameter = (
  expression: string,
  expressionIndex: number,
  fileContent: string,
  visitedIdentifiers: Set<string> = new Set(),
): boolean => {
  const identifier = expression.trim().match(/^([\w$]+)$/)?.[1];
  if (identifier === undefined || visitedIdentifiers.has(identifier)) return false;
  if (findContainingFunctionParameterSource(identifier, expressionIndex, fileContent) !== null) {
    return true;
  }
  const declaration = findVisibleIdentifierDeclaration(identifier, expressionIndex, fileContent);
  if (!declaration || !isDeclarationStable(identifier, declaration, expressionIndex, fileContent)) {
    return false;
  }
  const nextVisitedIdentifiers = new Set(visitedIdentifiers);
  nextVisitedIdentifiers.add(identifier);
  return isBackedByFunctionParameter(
    declaration.initializer,
    declaration.initializerStartIndex,
    fileContent,
    nextVisitedIdentifiers,
  );
};

const isHtmlTainted = (
  expression: string,
  fileContent: string,
  sinkIndex: number,
  visitedIdentifiers: Set<string>,
  visitedCallSites: Set<number>,
): boolean => {
  const trimmedExpression = expression.trim();
  if (isExplicitlyTrustedHtmlValue(trimmedExpression, fileContent, sinkIndex)) return false;
  const identifier = trimmedExpression.match(/^([\w$]+)(?:\.|\s*(?:[;,})\n]|$))/)?.[1];
  if (identifier === undefined) return HTML_TAINT_PATTERN.test(trimmedExpression);
  if (visitedIdentifiers.has(identifier)) return false;
  visitedIdentifiers.add(identifier);

  const declaration = findVisibleIdentifierDeclaration(identifier, sinkIndex, fileContent);
  const parameterSource = findContainingFunctionParameterSource(identifier, sinkIndex, fileContent);
  const doesDeclarationShadowParameter =
    declaration !== null &&
    (parameterSource === null ||
      declaration.declarationIndex > parameterSource.declarationNameIndex);
  if (doesDeclarationShadowParameter) {
    if (
      isDeclarationStable(identifier, declaration, sinkIndex, fileContent) &&
      isExplicitlyTrustedHtmlValue(
        declaration.initializer,
        fileContent,
        declaration.initializerStartIndex,
      )
    ) {
      return false;
    }
    if (!isDeclarationStable(identifier, declaration, sinkIndex, fileContent)) return true;
    const isInitializerTainted = isHtmlTainted(
      declaration.initializer,
      fileContent,
      declaration.initializerStartIndex,
      visitedIdentifiers,
      visitedCallSites,
    );
    if (isInitializerTainted) return true;
    if (
      isBackedByFunctionParameter(
        declaration.initializer,
        declaration.initializerStartIndex,
        fileContent,
      )
    ) {
      return false;
    }
    return HTML_TAINT_PATTERN.test(trimmedExpression);
  }
  if (parameterSource !== null && parameterSource.functionName.length > 0) {
    const callPattern = new RegExp(`\\b${escapeRegExp(parameterSource.functionName)}\\s*\\(`, "g");
    let didInspectCallArgument = false;
    let didInspectOnlyExplicitlyTrustedArguments = true;
    for (const callMatch of fileContent.matchAll(callPattern)) {
      if (
        callMatch.index === parameterSource.declarationNameIndex ||
        visitedCallSites.has(callMatch.index)
      ) {
        continue;
      }
      const openingParenthesisIndex = callMatch.index + callMatch[0].lastIndexOf("(");
      const closingParenthesisIndex = findMatchingBracket(fileContent, openingParenthesisIndex);
      if (closingParenthesisIndex < 0) continue;
      const argument = splitTopLevelArguments(
        fileContent.slice(openingParenthesisIndex + 1, closingParenthesisIndex),
      )[parameterSource.parameterIndex];
      if (argument === undefined) continue;
      const isCallInsideFunctionBody =
        callMatch.index >= parameterSource.declarationNameIndex &&
        callMatch.index <= parameterSource.bodyEndIndex;
      if (
        isCallInsideFunctionBody &&
        doesExpressionAliasIdentifier(argument, identifier, callMatch.index, fileContent)
      ) {
        continue;
      }
      didInspectCallArgument = true;
      didInspectOnlyExplicitlyTrustedArguments &&= isExplicitlyTrustedHtmlValue(
        argument,
        fileContent,
        callMatch.index,
      );
      const callVisitedIdentifiers = new Set(visitedIdentifiers);
      callVisitedIdentifiers.delete(identifier);
      const nextVisitedCallSites = new Set(visitedCallSites);
      nextVisitedCallSites.add(callMatch.index);
      if (
        isHtmlTainted(
          argument,
          fileContent,
          callMatch.index,
          callVisitedIdentifiers,
          nextVisitedCallSites,
        )
      ) {
        return true;
      }
    }
    if (didInspectCallArgument) {
      return (
        !didInspectOnlyExplicitlyTrustedArguments && HTML_TAINT_PATTERN.test(trimmedExpression)
      );
    }
    return HTML_TAINT_PATTERN.test(trimmedExpression);
  }

  return HTML_TAINT_PATTERN.test(trimmedExpression);
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
    if (HIDDEN_TOOLING_DIRECTORY_PATTERN.test(file.relativePath)) return [];
    if (SANITIZER_WRAPPER_PATH_PATTERN.test(file.relativePath)) return [];
    if (!DANGEROUS_HTML_PATTERN.test(file.content)) return [];

    const katexSinkProofRanges = collectKatexSinkProofRanges(file.content, file.absolutePath);
    const findings: ScanFinding[] = [];
    const lines = file.content.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      if (!DANGEROUS_HTML_PATTERN.test(line)) continue;

      // Skip sinks inside a comment — commented-out code never runs. Strip string
      // literals first so a protocol-relative URL (`"//cdn"`) before a real sink
      // on the same line is not mistaken for a `//` comment.
      const textBeforeSinkOnLine = line.slice(0, line.search(DANGEROUS_HTML_PATTERN));
      const codeBeforeSinkOnLine = textBeforeSinkOnLine.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");
      if (/(?:^|[^:])\/\//.test(codeBeforeSinkOnLine) || /^\s*[/*]/.test(line)) continue;

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
      const sinkIndex =
        lines.slice(0, lineIndex).join("\n").length +
        (lineIndex > 0 ? 1 : 0) +
        line.search(DANGEROUS_HTML_PATTERN);
      const katexSinkProof = katexSinkProofRanges.find(
        (range) => sinkIndex >= range.startIndex && sinkIndex < range.endIndex,
      )?.proof;
      if (katexSinkProof?.isConclusive && katexSinkProof.isSafe) continue;
      const hasUnsafeKatexProof = katexSinkProof?.isConclusive === true;

      if (STRING_LITERAL_VALUE_PATTERN.test(valueExpression)) continue;
      if (MODULE_CONSTANT_VALUE_PATTERN.test(valueExpression)) continue;
      // `a.innerHTML = b.innerHTML` (with optional static transform) re-serializes
      // existing DOM content. But a `+` concat, or a tainted token in a transform
      // argument (`.replace(x, props.userHtml)`), can splice in fresh input.
      if (
        DOM_CONTENT_SOURCE_VALUE_PATTERN.test(valueExpression) &&
        !valueExpression.includes("+")
      ) {
        const afterDomRead = valueExpression.replace(DOM_CONTENT_SOURCE_VALUE_PATTERN, "");
        if (!HTML_TAINT_PATTERN.test(afterDomRead)) continue;
      }
      if (isAllOperandsDomContentConcat(valueExpression)) continue;

      const longValueTail = HTML_VALUE_START_PATTERN.exec(
        lines.slice(lineIndex, lineIndex + 1 + STATIC_TEMPLATE_LOOKAHEAD_LINES).join("\n"),
      )?.[1]?.trimStart();
      let templateInterpolations = getTemplateInterpolations(longValueTail ?? fullValueTail);

      const isIdentifierShapedValue =
        BARE_IDENTIFIER_VALUE_PATTERN.test(valueExpression) ||
        MEMBER_OR_INDEX_ACCESS_VALUE_PATTERN.test(valueExpression) ||
        IDENTIFIER_WITH_LITERAL_FALLBACK_PATTERN.test(valueExpression);
      const valueIdentifier = isIdentifierShapedValue
        ? valueExpression.match(/^[\w$]+/)?.[0]
        : undefined;

      // A bare-identifier value declared from static text — a string-literal
      // concat or a template literal — is judged by its declaration: the
      // static text cannot be injection, only the interpolations can.
      if (
        templateInterpolations === null &&
        valueIdentifier !== undefined &&
        BARE_IDENTIFIER_VALUE_PATTERN.test(valueExpression) &&
        findContainingFunctionParameterSource(valueIdentifier, sinkIndex, file.content) === null
      ) {
        const declarationInitializer = getIdentifierDeclarationInitializer(
          valueIdentifier,
          sinkIndex,
          file.content,
        );
        if (declarationInitializer !== null) {
          if (isPureStringLiteralConcat(declarationInitializer)) continue;
          templateInterpolations = getTemplateInterpolations(declarationInitializer);
        }
      }

      if (templateInterpolations === "") continue;
      const judgedExpression = templateInterpolations ?? valueExpression;
      const doesJudgedExpressionCombineValues =
        splitTopLevelByPlus(judgedExpression).length > 1 ||
        (templateInterpolations?.match(/\$\{/g)?.length ?? 0) > 1;

      if (
        !hasUnsafeKatexProof &&
        !doesJudgedExpressionCombineValues &&
        SANITIZER_PATTERN.test(judgedExpression)
      ) {
        continue;
      }
      if (!doesJudgedExpressionCombineValues && ENV_CONFIG_VALUE_PATTERN.test(judgedExpression)) {
        continue;
      }
      if (!doesJudgedExpressionCombineValues && I18N_VALUE_PATTERN.test(judgedExpression)) continue;
      if (
        !hasUnsafeKatexProof &&
        !isHtmlTainted(judgedExpression, file.content, sinkIndex, new Set(), new Set())
      ) {
        continue;
      }
      if (!hasUnsafeKatexProof && ESCAPING_SERIALIZER_CALL_PATTERN.test(valueExpression)) continue;
      // Highlighter output: a `highlighted*` value is escaped, token-wrapped
      // markup by naming convention (often passed as a prop or routed through
      // React state, so no direct serializer assignment is visible); a present-
      // tense `highlight*` value is trusted only when the file uses a highlighter
      // library. (`highlight*()` calls are handled by the serializer-call check.)
      if (
        !hasUnsafeKatexProof &&
        isTrustedHighlighterValue(valueExpression, file.content, sinkIndex)
      ) {
        continue;
      }
      // Value is a bare identifier, member/index access, or identifier with a
      // literal fallback: exempt only when that identifier is assigned from a
      // serializer or a sanitizer in the file. `[:=]` accepts property-style
      // provenance too (`{ html: hl.codeToHtml(code) }` routed through state).
      if (valueIdentifier !== undefined) {
        const escapedIdentifier = escapeRegExp(valueIdentifier);
        const visibleDeclaration = findVisibleIdentifierDeclaration(
          valueIdentifier,
          sinkIndex,
          file.content,
        );
        const visibleInitializer = visibleDeclaration?.initializer;
        const isCompoundInitializer =
          visibleInitializer !== undefined &&
          (splitTopLevelByPlus(visibleInitializer).length > 1 ||
            (visibleInitializer.match(/\$\{/g)?.length ?? 0) > 1);
        if (!isCompoundInitializer) {
          const fromSerializer = new RegExp(
            `\\b${escapedIdentifier}\\b\\s*${SERIALIZER_ASSIGNMENT_PATTERN.source}`,
            "i",
          );
          if (
            !hasUnsafeKatexProof &&
            (visibleInitializer === undefined
              ? fromSerializer.test(file.content)
              : visibleDeclaration !== null &&
                isDeclarationStable(valueIdentifier, visibleDeclaration, sinkIndex, file.content) &&
                SERIALIZER_CALL_PROVENANCE_PATTERN.test(visibleInitializer))
          ) {
            continue;
          }
          const fromSanitizer = new RegExp(
            `\\b${escapedIdentifier}\\b\\s*${SANITIZED_ASSIGNMENT_PATTERN.source}`,
            "i",
          );
          if (
            !hasUnsafeKatexProof &&
            (visibleInitializer === undefined
              ? fromSanitizer.test(file.content)
              : visibleDeclaration !== null &&
                isDeclarationStable(valueIdentifier, visibleDeclaration, sinkIndex, file.content) &&
                SANITIZED_ASSIGNMENT_PATTERN.test(`=${visibleInitializer}`))
          ) {
            continue;
          }
        }
        const fromDomContent = new RegExp(
          `\\b${escapedIdentifier}\\b\\s*${DOM_CONTENT_ASSIGNMENT_PATTERN.source}`,
        );
        if (fromDomContent.test(file.content)) continue;
        // Highlighter output rendered per line: the identifier is the `.map(`
        // callback parameter over a `highlight*`-named array
        // (`highlightedLines.map((lineHtml, i) => …)`) and the file uses a
        // highlighter library.
        const highlighterMapCallbackPattern = new RegExp(
          `highlight[\\w$]*\\s*\\.map\\(\\s*(?:async\\s+)?\\(?\\s*${escapedIdentifier}\\b`,
          "i",
        );
        if (
          highlighterMapCallbackPattern.test(file.content) &&
          HIGHLIGHTER_LIBRARY_PATTERN.test(file.content)
        ) {
          continue;
        }
      }
      // A member-access value whose property is populated from an i18n call
      // (`questions = [{ body: translate("…") }]` then `question.body`) is
      // developer-authored bundle content, same as a direct `t()` value.
      if (MEMBER_OR_INDEX_ACCESS_VALUE_PATTERN.test(valueExpression)) {
        const propertyName = valueExpression.match(/\.([\w$]+)\s*(?:[;,})\n]|$)/)?.[1];
        if (propertyName !== undefined) {
          const i18nPropertyProvenancePattern = new RegExp(
            `\\b${escapeRegExp(propertyName)}\\s*:\\s*${I18N_VALUE_PATTERN.source}`,
          );
          if (i18nPropertyProvenancePattern.test(file.content)) continue;
        }
      }
      const sinkTargetMatch = INNERHTML_TARGET_PATTERN.exec(line);
      const sinkTarget = sinkTargetMatch?.[1] ?? sinkTargetMatch?.[2];
      if (sinkTarget !== undefined && isInertParseTarget(sinkTarget, file.content)) {
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
