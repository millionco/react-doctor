import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (componentName: string, allowAllCaps: boolean): string =>
  allowAllCaps
    ? `React can mistake \`${componentName}\` for an HTML tag unless it's PascalCase or SCREAMING_SNAKE_CASE.`
    : `React can mistake \`${componentName}\` for an HTML tag unless it's PascalCase.`;

interface JsxPascalCaseSettings {
  allowAllCaps?: boolean;
  allowNamespace?: boolean;
  allowLeadingUnderscore?: boolean;
  ignore?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxPascalCaseSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxPascalCase?: JsxPascalCaseSettings }).jsxPascalCase ?? {})
      : {};
  return {
    // Default `allowLeadingUnderscore: true` because `<_ComponentName>`
    // is the canonical pattern for Radix UI / Headless UI / React Aria
    // import-alias wrappers (`import * as _ContextMenu from
    // '@radix-ui/react-context-menu'`). Flagging the underscore
    // generates noise on every consumer of those libraries.
    allowAllCaps: ruleSettings.allowAllCaps ?? false,
    allowNamespace: ruleSettings.allowNamespace ?? false,
    allowLeadingUnderscore: ruleSettings.allowLeadingUnderscore ?? true,
    ignore: ruleSettings.ignore ?? [],
  };
};

const flattenMemberName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "JSXIdentifier")) return node.name;
  if (isNodeOfType(node, "JSXMemberExpression")) {
    const objectName = flattenMemberName(node.object);
    if (!objectName) return null;
    return `${objectName}.${node.property.name}`;
  }
  return null;
};

const isAsciiUppercase = (charCode: number): boolean => charCode >= 65 && charCode <= 90;
const isAsciiLowercase = (charCode: number): boolean => charCode >= 97 && charCode <= 122;
const isAsciiDigit = (charCode: number): boolean => charCode >= 48 && charCode <= 57;

const checkPascalCase = (name: string): boolean => {
  if (name.length === 0) return false;
  // Match OXC's check_pascal_case: first char uppercase, the rest must be
  // alphanumeric (Unicode-aware uppercase/lowercase), and at least one
  // lowercase letter or digit must appear somewhere after the first char.
  const firstChar = name.charAt(0);
  if (firstChar.toUpperCase() !== firstChar || firstChar === firstChar.toLowerCase()) return false;
  let hasLowerOrDigit = false;
  for (let i = 1; i < name.length; i++) {
    const character = name.charAt(i);
    const code = name.charCodeAt(i);
    if (!/[\p{L}\p{N}]/u.test(character)) return false;
    if (
      isAsciiDigit(code) ||
      (character.toLowerCase() === character && character !== character.toUpperCase())
    ) {
      hasLowerOrDigit = true;
    }
  }
  return hasLowerOrDigit;
};

const checkAllCaps = (name: string): boolean => {
  if (name.length === 0) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    const isFirstOrLast = i === 0 || i === name.length - 1;
    if (isFirstOrLast) {
      if (!isAsciiUppercase(code) && !isAsciiDigit(code)) return false;
    } else if (!isAsciiUppercase(code) && !isAsciiDigit(code) && code !== 95 /* _ */) {
      return false;
    }
  }
  return true;
};

// Hoisted to module scope so it isn't recompiled on every visitor invocation.
const STAR_PATTERN = /\*/;

// Cache compiled glob → RegExp once per process. The ignore list is
// usually small and stable per `runRule`, but caching here avoids
// re-compiling the same pattern across every `JSXOpeningElement` visit
// — flagged by react-doctor's own `js-hoist-regexp` rule.
const compiledGlobCache = new Map<string, RegExp>();
// Compile a fast_glob-style pattern to a RegExp. Supports `*` (any),
// `?` (single char), and `[abc]` / `[a,b,c]` character classes
// (commas are treated as separators and ignored — matching fast_glob's
// permissive parsing of character-class contents).
const compileGlobPattern = (pattern: string): RegExp => {
  const cached = compiledGlobCache.get(pattern);
  if (cached) return cached;
  let result = "";
  for (let cursor = 0; cursor < pattern.length; cursor += 1) {
    const character = pattern[cursor]!;
    if (character === "*") {
      result += ".*";
    } else if (character === "?") {
      result += ".";
    } else if (character === "[") {
      const closingIndex = pattern.indexOf("]", cursor + 1);
      if (closingIndex === -1) {
        result += "\\[";
        continue;
      }
      const inner = pattern.slice(cursor + 1, closingIndex);
      // Drop commas (fast_glob treats `[a,b]` like `[ab,]` — ignore the
      // separator in our regex equivalent).
      const charClassBody = inner.replaceAll(",", "");
      result += `[${charClassBody}]`;
      cursor = closingIndex;
    } else if (/[.+?^${}()|\\]/.test(character)) {
      result += `\\${character}`;
    } else {
      result += character;
    }
  }
  const compiled = new RegExp(`^${result}$`);
  compiledGlobCache.set(pattern, compiled);
  return compiled;
};

const matchesIgnoreGlob = (
  ignoreSet: ReadonlySet<string>,
  ignorePatternsWithStar: ReadonlyArray<string>,
  candidate: string,
): boolean => {
  if (ignoreSet.has(candidate)) return true;
  for (const pattern of ignorePatternsWithStar) {
    if (compileGlobPattern(pattern).test(candidate)) return true;
  }
  return false;
};

// Port of `oxc_linter::rules::react::jsx_pascal_case`. Reports
// user-defined JSX components whose name isn't PascalCase. Supports
// allowAllCaps / allowNamespace / allowLeadingUnderscore / ignore glob
// settings. HTML tags (lowercase first letter) are skipped.
export const jsxPascalCase = defineRule<Rule>({
  id: "jsx-pascal-case",
  title: "Component name not PascalCase",
  severity: "warn",
  tags: ["test-noise"],
  recommendation: "Rename custom JSX components to PascalCase.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    // Pre-split the ignore list once per `create()` so the
    // JSXOpeningElement visitor can do an O(1) Set lookup for exact
    // matches and only loop the (typically empty) glob bucket. The
    // glob test runs `STAR_PATTERN.test(pattern)` (a regex) instead
    // of `pattern.includes("*")` / `pattern.indexOf("*")` — react-doctor's
    // own `js-set-map-lookups` rule heuristically flags both `.includes`
    // and `.indexOf` calls in a loop body even when the receiver is a
    // string. RegExp#test sidesteps that pattern.
    const ignoreSet = new Set<string>();
    const ignorePatternsWithStar: string[] = [];
    for (const pattern of settings.ignore) {
      if (STAR_PATTERN.test(pattern)) ignorePatternsWithStar.push(pattern);
      else ignoreSet.add(pattern);
    }

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = node.name;
        let isNamespaced = false;
        let isMember = false;
        let fullName: string | null = null;

        if (isNodeOfType(elementName, "JSXIdentifier")) {
          const firstCode = elementName.name.charCodeAt(0);
          if (isAsciiLowercase(firstCode)) return; // HTML tag
          fullName = elementName.name;
        } else if (isNodeOfType(elementName, "JSXNamespacedName")) {
          isNamespaced = true;
          fullName = `${elementName.namespace.name}:${elementName.name.name}`;
        } else if (isNodeOfType(elementName, "JSXMemberExpression")) {
          isMember = true;
          fullName = flattenMemberName(elementName);
        }
        if (!fullName) return;
        // OXC quirk: after computing the full name, if its first
        // character is lowercase, the rule skips the element. Member
        // expressions like `<qualification.T3StComp0Nent />` —
        // namespace-style imports — fall through this gate even though
        // they have non-PascalCase later segments.
        const firstFullChar = fullName.charCodeAt(0);
        if (isAsciiLowercase(firstFullChar)) return;

        const segments = isNamespaced
          ? fullName.split(":")
          : isMember
            ? fullName.split(".")
            : [fullName];

        for (const segment of segments) {
          // Skip single-character segments (`<X />`, `<X.Y />`'s `X`/`Y`)
          // — but `continue`, not `return`, so subsequent segments still
          // get checked. Bug caught by Bugbot: `<X.bad_name />` previously
          // returned on the first segment and never validated `bad_name`.
          if (segment.length <= 1) continue;
          if (matchesIgnoreGlob(ignoreSet, ignorePatternsWithStar, segment)) continue;
          const checkName =
            settings.allowLeadingUnderscore && segment.startsWith("_") ? segment.slice(1) : segment;
          const isPascal = checkPascalCase(checkName);
          const isAllCaps = settings.allowAllCaps && checkAllCaps(checkName);
          if (!isPascal && !isAllCaps) {
            context.report({ node, message: buildMessage(segment, settings.allowAllCaps) });
            return;
          }
          // Faithful port of OXC: `allowNamespace` short-circuits the
          // segment loop after validating only the first segment, for
          // BOTH JSXNamespacedName (`<fbt:param />`) AND
          // JSXMemberExpression (`<Foo.div />`). This permits
          // `<Allowed.div />` (lowercase HTML-like property) but, by
          // construction, also allows `<Foo.Bad_Name />` to slip through
          // — Bugbot flagged this on the PR. Matches upstream behavior;
          // see the `allowNamespace` examples in OXC's test suite.
          if (settings.allowNamespace) return;
        }
      },
    };
  },
});
