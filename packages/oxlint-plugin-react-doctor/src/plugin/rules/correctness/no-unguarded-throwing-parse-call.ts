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
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DECODE_MESSAGE =
  "This decodes a URL/route value with `decodeURIComponent`/`decodeURI`, which throws `URIError` on a malformed percent-escape (a lone `%`, `100%off`) and unwinds render or aborts the handler. Wrap it in a try/catch, or route it through a `safe*` helper that returns a fallback.";
const COLOR_MESSAGE =
  "This parses a runtime color with a library that throws on input it cannot resolve (most often a `var(--x)` CSS variable), crashing render on exactly the theme values you did not test. Wrap it in a try/catch, or route it through a `safe*` helper that returns a fallback.";
const URL_MESSAGE =
  "This builds a `URL` from a runtime URL/route value (`params`, `searchParams`, a `location` field), which throws `TypeError` on a malformed string and crashes render. Guard it with `URL.canParse`, pass a base-URL second argument, or wrap the call in a try/catch.";

const DECODE_CALLEE_NAMES = new Set(["decodeURIComponent", "decodeURI"]);
const COLOR_CALLEE_NAMES = new Set(["readableColor", "parseToRgb", "chroma"]);

// A prop/param named after a URL/route field, or a well-known route source.
const URL_ROUTE_FIELD_NAMES = new Set(["url", "path", "ref", "branch", "query"]);
const URL_ROUTE_SOURCE_ROOTS = new Set(["searchParams", "params", "location"]);

// Roots whose values are runtime URL/route input: route params, query strings,
// location fields, and framework request objects. The `new URL(x)` arm only
// fires when the argument traces to one of these — an app-internal config URL
// (imported constant, `this.baseUrl`, `props.server.http.url`) is a validated
// invariant, not runtime-malformed input.
const URL_UNTRUSTED_ROOT_NAMES = new Set(["searchParams", "params", "location", "request", "req"]);

const MAX_INITIALIZER_TRACE_DEPTH = 5;

// Non-render/library plumbing, vendored/static artifacts, and controlled-input
// files where the throw is not a user-facing render/handler crash.
const EXCLUDED_FILE_PATTERN =
  /(\.test\.|\.spec\.|__tests__|\/dist\/|\/build\/|\.min\.|(^|\/)(scripts|vendor|public)\/)/;

// A template literal whose first quasi hard-codes an absolute scheme+host
// prefix (`https://github.com/${owner}/…`) cannot make `new URL` throw: after
// a valid origin the remainder is percent-encoded, never rejected.
const ABSOLUTE_ORIGIN_PREFIX_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]/i;

const nameOfFunction = (fn: EsTreeNode): string | null => {
  if (isNodeOfType(fn, "FunctionDeclaration") && fn.id) return fn.id.name;
  const parent = fn.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  if (isNodeOfType(parent, "Property") && isNodeOfType(parent.key, "Identifier")) {
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
  isNodeOfType(node, "MemberExpression") && getRootIdentifierName(node) === "process";

const findEnclosingDeclarator = (
  bindingIdentifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// True when the argument is a literal, a template with a hardcoded absolute
// origin prefix, a `process.env.*` read, or an identifier bound to a
// module-scope `const` literal/env value — none are runtime-malformed input,
// so `new URL(x)` cannot throw on user data.
const isCompileTimeOrModuleConst = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  if (isNodeOfType(inner, "Literal")) return true;
  if (isNodeOfType(inner, "TemplateLiteral")) {
    if (inner.expressions.length === 0) return true;
    const firstQuasi = inner.quasis[0];
    return Boolean(firstQuasi && ABSOLUTE_ORIGIN_PREFIX_PATTERN.test(firstQuasi.value.raw));
  }
  if (isProcessEnvMember(inner)) return true;
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    if (!binding) return false;
    const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
    if (!declarator || declarator.id !== binding.bindingIdentifier) return false;
    const declaration = declarator.parent;
    if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const") {
      return false;
    }
    const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
    if (!init) return false;
    return isNodeOfType(init, "Literal") || isProcessEnvMember(init);
  }
  return false;
};

const argumentTracesToUrlRouteSource = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  const rootName = getRootIdentifierName(inner);
  if (rootName && URL_ROUTE_SOURCE_ROOTS.has(rootName)) return true;
  if (isNodeOfType(inner, "Identifier") && URL_ROUTE_FIELD_NAMES.has(inner.name)) return true;
  if (
    isNodeOfType(inner, "MemberExpression") &&
    isNodeOfType(inner.property, "Identifier") &&
    URL_ROUTE_FIELD_NAMES.has(inner.property.name)
  ) {
    return true;
  }
  if (subtreeReferencesIdentifierName(inner, URL_ROUTE_SOURCE_ROOTS)) return true;
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    const declarator = binding ? findEnclosingDeclarator(binding.bindingIdentifier) : null;
    if (declarator && declarator.init) {
      return argumentTracesToUrlRouteSource(declarator.init as EsTreeNode);
    }
  }
  return false;
};

const isRuntimeColorArgument = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  return isNodeOfType(inner, "Identifier") || isNodeOfType(inner, "MemberExpression");
};

// Request objects whose `.url` is a framework-guaranteed valid absolute URL.
const REQUEST_URL_ROOTS = new Set(["request", "req"]);
// Receivers whose zero-arg `.url()` returns a valid absolute URL (Playwright
// `page.url()`, a framework request's `.url()`). Gated to these so an arbitrary
// `anything.url()` no longer defeats the rule.
const LIVE_URL_ACCESSOR_RECEIVERS = new Set(["page", "request", "req"]);

const LOCATION_OWNER_NAMES = new Set(["window", "document", "globalThis"]);

// A reference to the Location object itself: bare `location`,
// `window.location`, `document.location`. Passing the object to `new URL`
// stringifies it to `href`, a spec-guaranteed valid absolute URL.
const isLocationObjectReference = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Identifier")) return node.name === "location";
  return (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === "location" &&
    isNodeOfType(node.object, "Identifier") &&
    LOCATION_OWNER_NAMES.has(node.object.name)
  );
};

// Expressions that always yield a syntactically-valid absolute URL string:
// `location.href` on any Location reference (NOT `.pathname`/`.search`/`.hash`,
// which are not absolute URLs and DO throw), `document.URL`, `import.meta.url`,
// a framework request's own `.url`, and a live-URL accessor call on a known
// receiver. Each arm requires the exact shape so a user-controlled deep chain
// (`request.body.url`) still gets flagged.
const isValidUrlStringSource = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "CallExpression")) {
    return (
      node.arguments.length === 0 &&
      isNodeOfType(node.callee, "MemberExpression") &&
      !node.callee.computed &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "url" &&
      isNodeOfType(node.callee.object, "Identifier") &&
      LIVE_URL_ACCESSOR_RECEIVERS.has(node.callee.object.name)
    );
  }
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return false;
  if (!isNodeOfType(node.property, "Identifier")) return false;
  const propertyName = node.property.name;
  if (propertyName === "href") return isLocationObjectReference(node.object);
  if (propertyName === "URL") {
    return isNodeOfType(node.object, "Identifier") && node.object.name === "document";
  }
  if (propertyName === "url") {
    if (isNodeOfType(node.object, "MetaProperty")) return true;
    return isNodeOfType(node.object, "Identifier") && REQUEST_URL_ROOTS.has(node.object.name);
  }
  return false;
};

// True for the Location object itself and for any member/call chain derived
// from an always-valid URL string (`location.href.split("?")[0]`) — stripping
// the query/fragment off an absolute URL keeps it parseable, so `new URL`
// cannot throw. Descent stops at plain identifiers so `location.pathname`
// (derived from the object, not from `.href`) still gets flagged.
const isAlwaysValidUrlArgument = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  if (isLocationObjectReference(inner)) return true;
  let cursor: EsTreeNode | null = inner;
  while (cursor) {
    if (isValidUrlStringSource(cursor)) return true;
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      cursor = cursor.callee;
      continue;
    }
    break;
  }
  return false;
};

const isUntrustedUrlArgument = (argument: EsTreeNode, traceDepth: number): boolean => {
  if (traceDepth > MAX_INITIALIZER_TRACE_DEPTH) return false;
  const inner = stripParenExpression(argument);
  if (isCompileTimeOrModuleConst(inner)) return false;
  if (isAlwaysValidUrlArgument(inner)) return false;
  if (isNodeOfType(inner, "TemplateLiteral")) {
    return inner.expressions.some((expression) =>
      isUntrustedUrlArgument(expression as EsTreeNode, traceDepth + 1),
    );
  }
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    const declarator = binding ? findEnclosingDeclarator(binding.bindingIdentifier) : null;
    if (declarator && declarator.init) {
      return isUntrustedUrlArgument(declarator.init as EsTreeNode, traceDepth + 1);
    }
    return URL_ROUTE_FIELD_NAMES.has(inner.name);
  }
  const rootName = getRootIdentifierName(inner, { followCallChains: true });
  if (rootName && URL_UNTRUSTED_ROOT_NAMES.has(rootName)) return true;
  return subtreeReferencesIdentifierName(inner, URL_ROUTE_SOURCE_ROOTS);
};

// Non-throwing validity pre-checks these APIs document precisely so callers
// can avoid try/catch: `URL.canParse(x)`, `chroma.valid(x)`, `x.isValid()`.
const VALIDITY_CHECK_METHOD_NAMES = new Set(["canParse", "valid", "isValid"]);

const containsValidityCheckCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  let didFindCheck = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindCheck) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      !child.callee.computed &&
      isNodeOfType(child.callee.property, "Identifier") &&
      VALIDITY_CHECK_METHOD_NAMES.has(child.callee.property.name)
    ) {
      didFindCheck = true;
      return false;
    }
  });
  return didFindCheck;
};

const isEarlyExitStatement = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "ReturnStatement") ||
  isNodeOfType(statement, "ThrowStatement") ||
  isNodeOfType(statement, "ContinueStatement") ||
  isNodeOfType(statement, "BreakStatement");

const guardConsequentExitsEarly = (consequent: EsTreeNode): boolean => {
  if (isEarlyExitStatement(consequent)) return true;
  if (isNodeOfType(consequent, "BlockStatement")) {
    return consequent.body.some((statement) => isEarlyExitStatement(statement));
  }
  return false;
};

// True when the parse call is dominated by a validity pre-check within the
// same function: the guarded branch of an `if`/ternary/`&&` whose test runs a
// validity check, or preceded by an early-exit `if (!check(x)) return` guard.
const isGuardedByValidityCheck = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (
      isNodeOfType(parent, "IfStatement") &&
      parent.consequent === cursor &&
      containsValidityCheckCall(parent.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      parent.test !== cursor &&
      containsValidityCheckCall(parent.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === cursor &&
      containsValidityCheckCall(parent.left)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "BlockStatement") || isNodeOfType(parent, "Program")) {
      for (const statement of parent.body) {
        if (statement === cursor) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          containsValidityCheckCall(statement.test) &&
          guardConsequentExitsEarly(statement.consequent)
        ) {
          return true;
        }
      }
    }
    if (isFunctionLike(parent)) return false;
    cursor = parent;
    parent = parent.parent ?? null;
  }
  return false;
};

export const noUnguardedThrowingParseCall = defineRule({
  id: "no-unguarded-throwing-parse-call",
  title: "Unguarded call to a throwing parse API",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`decodeURIComponent`/`decodeURI`, color parsers (`readableColor`/`parseToRgb`/`chroma`), and single-arg `new URL(x)` on a URL/route value throw on malformed runtime input and crash render; guard with a validity pre-check (`URL.canParse`, `chroma.valid`), a try/catch, or a `safe*` helper that returns a fallback.",
  create: (context: RuleContext) => {
    const filename = context.filename ?? "";
    const fileIsExcluded = EXCLUDED_FILE_PATTERN.test(filename);
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (fileIsExcluded) return;
        if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "URL") return;
        if (node.arguments.length !== 1) return;
        const argument = node.arguments[0];
        if (!argument) return;
        if (isCompileTimeOrModuleConst(argument as EsTreeNode)) return;
        if (isAlwaysValidUrlArgument(argument as EsTreeNode)) return;
        if (!isUntrustedUrlArgument(argument as EsTreeNode, 0)) return;
        if (isInsideTryStatement(node as EsTreeNode)) return;
        if (isRoutedThroughSafeHelper(node as EsTreeNode)) return;
        if (isGuardedByValidityCheck(node as EsTreeNode)) return;
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
        if (isGuardedByValidityCheck(node as EsTreeNode)) return;
        context.report({ node: node as EsTreeNode, message: COLOR_MESSAGE });
      },
    };
  },
});
