import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DECODE_MESSAGE =
  "This decodes a URL/route value with `decodeURIComponent`/`decodeURI`, which throws `URIError` on a malformed percent-escape (a lone `%`, `100%off`) and unwinds render or aborts the handler. Wrap it in a try/catch, or route it through a `safe*` helper that returns a fallback.";
const COLOR_MESSAGE =
  "This parses a runtime color with a library that throws on input it cannot resolve (most often a `var(--x)` CSS variable), crashing render on exactly the theme values you did not test. Wrap it in a try/catch, or route it through a `safe*` helper that returns a fallback.";
const URL_MESSAGE =
  "This builds a `URL` from a single runtime argument, which throws `TypeError` on a malformed string and crashes render. Pass a base-URL second argument, or wrap the call in a try/catch.";

const DECODE_CALLEE_NAMES = new Set(["decodeURIComponent", "decodeURI"]);
const COLOR_CALLEE_NAMES = new Set([
  "readableColor",
  "parseToRgb",
  "chroma",
  "tinycolor",
]);

// A prop/param named after a URL/route field, or a well-known route source.
const URL_ROUTE_FIELD_NAMES = new Set([
  "url",
  "path",
  "ref",
  "branch",
  "query",
]);
const URL_ROUTE_SOURCE_ROOTS = new Set(["searchParams", "params", "location"]);

// Non-render/library plumbing and controlled-input files where the throw is
// not a user-facing render/handler crash.
const EXCLUDED_FILE_PATTERN =
  /(\.test\.|\.spec\.|__tests__|\/dist\/|\/build\/|\.min\.|(^|\/)scripts\/)/;

const nameOfFunction = (fn: EsTreeNode): string | null => {
  if (isNodeOfType(fn, "FunctionDeclaration") && fn.id) return fn.id.name;
  const parent = fn.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  if (
    isNodeOfType(parent, "Property") &&
    isNodeOfType(parent.key, "Identifier")
  ) {
    return parent.key.name;
  }
  return null;
};

const isRoutedThroughSafeHelper = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      const name = nameOfFunction(cursor);
      if (name && /^safe/i.test(name)) return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const hasEnclosingFunction = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const isProcessEnvMember = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  getRootIdentifierName(node) === "process";

const findEnclosingDeclarator = (
  bindingIdentifier: EsTreeNode
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// True when the argument is a literal, a `process.env.*` read, or an identifier
// bound to a module-scope `const` literal/env value — none are runtime-malformed
// input, so `new URL(x)` cannot throw on user data.
const isCompileTimeOrModuleConst = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  if (isNodeOfType(inner, "Literal")) return true;
  if (isNodeOfType(inner, "TemplateLiteral") && inner.expressions.length === 0)
    return true;
  if (isProcessEnvMember(inner)) return true;
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    if (!binding) return false;
    const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
    if (!declarator || declarator.id !== binding.bindingIdentifier)
      return false;
    const declaration = declarator.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const"
    ) {
      return false;
    }
    const init = declarator.init
      ? stripParenExpression(declarator.init as EsTreeNode)
      : null;
    if (!init) return false;
    return isNodeOfType(init, "Literal") || isProcessEnvMember(init);
  }
  return false;
};

const argumentTracesToUrlRouteSource = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  const rootName = getRootIdentifierName(inner);
  if (rootName && URL_ROUTE_SOURCE_ROOTS.has(rootName)) return true;
  if (
    isNodeOfType(inner, "Identifier") &&
    URL_ROUTE_FIELD_NAMES.has(inner.name)
  )
    return true;
  if (
    isNodeOfType(inner, "MemberExpression") &&
    isNodeOfType(inner.property, "Identifier") &&
    URL_ROUTE_FIELD_NAMES.has(inner.property.name)
  ) {
    return true;
  }
  if (subtreeReferencesIdentifierName(inner, URL_ROUTE_SOURCE_ROOTS))
    return true;
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    const declarator = binding
      ? findEnclosingDeclarator(binding.bindingIdentifier)
      : null;
    if (declarator && declarator.init) {
      return argumentTracesToUrlRouteSource(declarator.init as EsTreeNode);
    }
  }
  return false;
};

const isRuntimeColorArgument = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  return (
    isNodeOfType(inner, "Identifier") || isNodeOfType(inner, "MemberExpression")
  );
};

// Request objects whose `.url` is a framework-guaranteed valid absolute URL.
const REQUEST_URL_ROOTS = new Set(["request", "req"]);
// Receivers whose zero-arg `.url()` returns a valid absolute URL (Playwright
// `page.url()`, a framework request's `.url()`). Gated to these so an arbitrary
// `anything.url()` no longer defeats the rule.
const LIVE_URL_ACCESSOR_RECEIVERS = new Set(["page", "request", "req"]);

// `new URL(x)` sources that are always a syntactically-valid absolute URL and
// so can never throw: `location.href` / `window.location.href` (NOT
// `location.pathname`/`.search`/`.hash`, which are not absolute URLs and DO
// throw), `document.URL`, a framework request's own `.url`, and a live-URL
// accessor call on a known receiver. Each arm requires the exact shape so a
// user-controlled deep chain (`request.body.url`) still gets flagged.
const isAlwaysValidUrlArgument = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  if (
    isNodeOfType(inner, "CallExpression") &&
    inner.arguments.length === 0 &&
    isNodeOfType(inner.callee, "MemberExpression") &&
    !inner.callee.computed &&
    isNodeOfType(inner.callee.property, "Identifier") &&
    inner.callee.property.name === "url" &&
    isNodeOfType(inner.callee.object, "Identifier") &&
    LIVE_URL_ACCESSOR_RECEIVERS.has(inner.callee.object.name)
  ) {
    return true;
  }
  if (!isNodeOfType(inner, "MemberExpression") || inner.computed) return false;
  if (!isNodeOfType(inner.property, "Identifier")) return false;
  const propertyName = inner.property.name;
  if (propertyName === "href") {
    const rootName = getRootIdentifierName(inner);
    return rootName === "location" || rootName === "window";
  }
  if (
    propertyName === "URL" &&
    isNodeOfType(inner.object, "Identifier") &&
    inner.object.name === "document"
  ) {
    return true;
  }
  return (
    propertyName === "url" &&
    isNodeOfType(inner.object, "Identifier") &&
    REQUEST_URL_ROOTS.has(inner.object.name)
  );
};

export const noUnguardedThrowingParseCall = defineRule({
  id: "no-unguarded-throwing-parse-call",
  title: "Unguarded call to a throwing parse API",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`decodeURIComponent`/`decodeURI`, color parsers (`readableColor`/`parseToRgb`/`chroma`/`tinycolor`), and single-arg `new URL(x)` throw on malformed runtime input and crash render; wrap the call in a try/catch or a `safe*` helper that returns a fallback.",
  create: (context: RuleContext) => {
    const filename = context.filename ?? "";
    const fileIsExcluded = EXCLUDED_FILE_PATTERN.test(filename);
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (fileIsExcluded) return;
        if (
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== "URL"
        )
          return;
        if (node.arguments.length !== 1) return;
        const argument = node.arguments[0];
        if (!argument) return;
        if (isCompileTimeOrModuleConst(argument as EsTreeNode)) return;
        if (isAlwaysValidUrlArgument(argument as EsTreeNode)) return;
        if (isInsideTryStatement(node as EsTreeNode)) return;
        if (isRoutedThroughSafeHelper(node as EsTreeNode)) return;
        context.report({ node: node as EsTreeNode, message: URL_MESSAGE });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (fileIsExcluded) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const calleeName = node.callee.name;
        const isDecode = DECODE_CALLEE_NAMES.has(calleeName);
        const isColor = COLOR_CALLEE_NAMES.has(calleeName);
        if (!isDecode && !isColor) return;

        const argument = node.arguments[0];
        if (!argument) return;
        if (isInsideTryStatement(node as EsTreeNode)) return;
        if (isRoutedThroughSafeHelper(node as EsTreeNode)) return;

        if (isDecode) {
          if (!argumentTracesToUrlRouteSource(argument as EsTreeNode)) return;
          context.report({ node: node as EsTreeNode, message: DECODE_MESSAGE });
          return;
        }

        // Color arm: a runtime color value parsed in a render/hook path.
        if (!isRuntimeColorArgument(argument as EsTreeNode)) return;
        if (!hasEnclosingFunction(node as EsTreeNode)) return;
        context.report({ node: node as EsTreeNode, message: COLOR_MESSAGE });
      },
    };
  },
});
