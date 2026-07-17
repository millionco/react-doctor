import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingDeclarator } from "../../utils/find-enclosing-declarator.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
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
const URI_ENCODER_NAMES = new Set(["encodeURIComponent", "encodeURI"]);
const COLOR_CALLEE_NAMES = new Set(["readableColor", "parseToRgb", "chroma"]);
const COLOR_PARSER_MODULE_NAMES = new Set(["chroma-js", "polished"]);

// A prop/param named after a URL/route field, or a well-known route source.
const URL_ROUTE_FIELD_NAMES = new Set(["url", "href", "path", "ref", "branch", "query"]);
const URL_ROUTE_SOURCE_ROOTS = new Set(["searchParams", "params", "location"]);
const URL_ROUTE_STRING_METHOD_NAMES = new Set(["slice", "split"]);
const URL_ROUTE_ALIAS_BINDING_KINDS = new Set(["const", "let", "var"]);

// Roots whose values are runtime URL/route input: route params, query strings,
// location fields, and framework request objects. The `new URL(x)` arm only
// fires when the argument traces to one of these — an app-internal config URL
// (imported constant, `this.baseUrl`, `props.server.http.url`) is a validated
// invariant, not runtime-malformed input.
const URL_UNTRUSTED_ROOT_NAMES = new Set(["searchParams", "params", "location", "request", "req"]);

const MAX_INITIALIZER_TRACE_DEPTH = 5;

// Vendored/static artifacts, build tooling, and demo/docs surfaces where the
// throw is not a user-facing render/handler crash (a docs color-palette page
// only ever receives the design-token set it renders). Tests, stories, and
// e2e files are additionally excluded by the `test-noise` tag.
const EXCLUDED_FILE_PATTERN = /(\/dist\/|\/build\/|\.min\.|(^|\/)(scripts|vendor|public|docs)\/)/;

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

// `location.origin` / `window.location.origin` is always a syntactically
// valid scheme+host, so a template that leads with it (`new URL(
// `${window.location.origin}/user/${id}`)`) cannot make `new URL` throw —
// the remainder after a valid origin is percent-encoded, never rejected.
const isLocationOriginRead = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (
    !isNodeOfType(stripped, "MemberExpression") ||
    stripped.computed ||
    !isNodeOfType(stripped.property, "Identifier") ||
    stripped.property.name !== "origin"
  ) {
    return false;
  }
  const locationObject = stripParenExpression(stripped.object);
  if (isNodeOfType(locationObject, "Identifier")) return locationObject.name === "location";
  return (
    isNodeOfType(locationObject, "MemberExpression") &&
    !locationObject.computed &&
    isNodeOfType(locationObject.property, "Identifier") &&
    locationObject.property.name === "location"
  );
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
    if (firstQuasi && ABSOLUTE_ORIGIN_PREFIX_PATTERN.test(firstQuasi.value.raw)) return true;
    // `${window.location.origin}/path` — the leading interpolation IS the
    // origin, so the template is origin-pinned the same way.
    return Boolean(
      firstQuasi &&
      firstQuasi.value.raw === "" &&
      inner.expressions[0] &&
      isLocationOriginRead(inner.expressions[0] as EsTreeNode),
    );
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

// `URLSearchParams#toString()` (react-router's `createSearchParams` returns a
// URLSearchParams) always emits well-formed percent-encoding: it cannot make
// `new URL` throw in any position and always decodes cleanly, so a
// serialization chain — with optional `.replace`/`.replaceAll`
// post-processing — is not runtime-malformed input even when the params were
// built from route/query values.
const SEARCH_PARAMS_CONSTRUCTOR_NAME_PATTERN = /^(URLSearchParams|createSearchParams)$/;

const isSearchParamsConstruction = (node: EsTreeNode, traceDepth: number): boolean => {
  if (traceDepth > MAX_INITIALIZER_TRACE_DEPTH) return false;
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "NewExpression") || isNodeOfType(inner, "CallExpression")) {
    const callee = stripParenExpression(inner.callee as EsTreeNode);
    return (
      isNodeOfType(callee, "Identifier") && SEARCH_PARAMS_CONSTRUCTOR_NAME_PATTERN.test(callee.name)
    );
  }
  if (isNodeOfType(inner, "Identifier")) {
    const binding = findVariableInitializer(inner, inner.name);
    const declarator = binding ? findEnclosingDeclarator(binding.bindingIdentifier) : null;
    if (declarator && declarator.init) {
      return isSearchParamsConstruction(declarator.init as EsTreeNode, traceDepth + 1);
    }
  }
  return false;
};

const isSearchParamsSerialization = (node: EsTreeNode, traceDepth: number): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = inner.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  if (callee.property.name === "toString") {
    return isSearchParamsConstruction(callee.object as EsTreeNode, traceDepth);
  }
  if (callee.property.name === "replace" || callee.property.name === "replaceAll") {
    return isSearchParamsSerialization(callee.object as EsTreeNode, traceDepth);
  }
  return false;
};

const isStaticIndexedMemberExpression = (
  node: EsTreeNode,
): node is EsTreeNodeOfType<"MemberExpression"> => {
  if (!isNodeOfType(node, "MemberExpression") || !node.computed) return false;
  const property = stripParenExpression(node.property as EsTreeNode);
  if (!isNodeOfType(property, "Literal")) return false;
  if (typeof property.value === "number") {
    return Number.isInteger(property.value) && property.value >= 0;
  }
  return typeof property.value === "string" && /^\d+$/.test(property.value);
};

const isUrlRouteStringMethodCall = (
  node: EsTreeNode,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee as EsTreeNode);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (!methodName || !URL_ROUTE_STRING_METHOD_NAMES.has(methodName)) return false;
  if (methodName !== "split") return true;
  const separator = node.arguments[0];
  return Boolean(separator && isNodeOfType(separator, "Literal") && separator.value === "/");
};

const findRootIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let cursor: EsTreeNode | null = stripParenExpression(node);
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      cursor = cursor.callee as EsTreeNode;
      continue;
    }
    break;
  }
  return cursor && isNodeOfType(cursor, "Identifier") ? cursor : null;
};

const hasRuntimeUrlRouteRoot = (node: EsTreeNode, context: RuleContext): boolean => {
  const rootIdentifier = findRootIdentifier(node);
  if (!rootIdentifier) return false;
  if (!URL_UNTRUSTED_ROOT_NAMES.has(rootIdentifier.name)) return false;
  const symbol = context.scopes.referenceFor(rootIdentifier)?.resolvedSymbol ?? null;
  if (!symbol) return true;
  return (
    symbol.kind === "parameter" && !hasSymbolWriteBefore(symbol, rootIdentifier, context.scopes)
  );
};

const isBuiltInUriEncoderCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = stripParenExpression(inner.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier") || !URI_ENCODER_NAMES.has(callee.name)) return false;
  return context.scopes.isGlobalReference(callee);
};

const argumentTracesToUrlRouteSource = (
  argument: EsTreeNode,
  context: RuleContext,
  traceDepth = 0,
): boolean => {
  if (traceDepth > MAX_INITIALIZER_TRACE_DEPTH) return false;
  const inner = stripParenExpression(argument);
  if (isSearchParamsSerialization(inner, 0)) return false;
  if (isBuiltInUriEncoderCall(inner, context)) return false;
  if (isNodeOfType(inner, "Identifier")) {
    if (URL_ROUTE_SOURCE_ROOTS.has(inner.name)) return true;
    const symbol = context.scopes.referenceFor(inner)?.resolvedSymbol ?? null;
    if (symbol) {
      if (hasSymbolWriteBefore(symbol, inner, context.scopes)) return false;
      if (
        URL_ROUTE_ALIAS_BINDING_KINDS.has(symbol.kind) &&
        isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
        symbol.declarationNode.id === symbol.bindingIdentifier &&
        symbol.initializer
      ) {
        return argumentTracesToUrlRouteSource(symbol.initializer, context, traceDepth + 1);
      }
      return (
        symbol.kind === "parameter" &&
        (URL_ROUTE_FIELD_NAMES.has(inner.name) || URL_ROUTE_SOURCE_ROOTS.has(inner.name))
      );
    }
    return URL_ROUTE_FIELD_NAMES.has(inner.name) || URL_ROUTE_SOURCE_ROOTS.has(inner.name);
  }
  const rootName = getRootIdentifierName(inner);
  const hasKnownUrlRouteSource =
    Boolean(rootName && URL_ROUTE_SOURCE_ROOTS.has(rootName)) ||
    subtreeReferencesIdentifierName(inner, URL_ROUTE_SOURCE_ROOTS);
  if (hasKnownUrlRouteSource) return true;
  const hasUrlRouteField =
    isNodeOfType(inner, "MemberExpression") &&
    isNodeOfType(inner.property, "Identifier") &&
    URL_ROUTE_FIELD_NAMES.has(inner.property.name);
  if (hasUrlRouteField && hasRuntimeUrlRouteRoot(inner, context)) return true;
  if (isStaticIndexedMemberExpression(inner)) {
    return argumentTracesToUrlRouteSource(inner.object as EsTreeNode, context, traceDepth + 1);
  }
  if (isUrlRouteStringMethodCall(inner)) {
    const callee = stripParenExpression(inner.callee as EsTreeNode);
    if (isNodeOfType(callee, "MemberExpression")) {
      return argumentTracesToUrlRouteSource(callee.object as EsTreeNode, context, traceDepth + 1);
    }
  }
  return false;
};

// Design-token theme objects (antd-style/emotion `useTheme()`, antd
// `theme.useToken()`) hold concrete computed color values, never `var(--x)`
// CSS custom properties — a color parse of `theme.<token>` cannot throw.
const THEME_TOKEN_ROOT_NAMES = new Set(["theme", "token", "tokens"]);
const THEME_HOOK_NAMES = new Set(["useTheme", "useToken"]);
const COMPUTED_STYLE_READ_NAMES = new Set(["getComputedStyle", "getPropertyValue"]);
const CSS_CUSTOM_PROPERTY_PATTERN = /var\(/;

const isThemeTokenReference = (rootIdentifier: EsTreeNodeOfType<"Identifier">): boolean => {
  if (THEME_TOKEN_ROOT_NAMES.has(rootIdentifier.name)) return true;
  const binding = findVariableInitializer(rootIdentifier, rootIdentifier.name);
  const initializer = binding?.initializer ?? null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const hookCallee = initializer.callee;
  if (isNodeOfType(hookCallee, "Identifier")) return THEME_HOOK_NAMES.has(hookCallee.name);
  return (
    isNodeOfType(hookCallee, "MemberExpression") &&
    !hookCallee.computed &&
    isNodeOfType(hookCallee.property, "Identifier") &&
    THEME_HOOK_NAMES.has(hookCallee.property.name)
  );
};

// The color arm only fires when the argument can actually carry a value the
// parser rejects at runtime — a `var(--x)` CSS custom property or an empty
// computed-style read: a string/template containing `var(`, a
// `getComputedStyle`/`getPropertyValue` read, or a component prop/param
// (traced through initializers). Theme/design-token members are concrete
// computed colors and are skipped.
const canCarryCssCustomProperty = (argument: EsTreeNode, traceDepth: number): boolean => {
  if (traceDepth > MAX_INITIALIZER_TRACE_DEPTH) return false;
  const inner = stripParenExpression(argument);
  if (isNodeOfType(inner, "Literal")) {
    return typeof inner.value === "string" && CSS_CUSTOM_PROPERTY_PATTERN.test(inner.value);
  }
  if (isNodeOfType(inner, "TemplateLiteral")) {
    return (
      inner.quasis.some((quasi) => CSS_CUSTOM_PROPERTY_PATTERN.test(quasi.value.raw)) ||
      inner.expressions.some((expression) =>
        canCarryCssCustomProperty(expression as EsTreeNode, traceDepth + 1),
      )
    );
  }
  if (isNodeOfType(inner, "ConditionalExpression")) {
    return (
      canCarryCssCustomProperty(inner.consequent as EsTreeNode, traceDepth + 1) ||
      canCarryCssCustomProperty(inner.alternate as EsTreeNode, traceDepth + 1)
    );
  }
  if (isNodeOfType(inner, "LogicalExpression")) {
    return (
      canCarryCssCustomProperty(inner.left as EsTreeNode, traceDepth + 1) ||
      canCarryCssCustomProperty(inner.right as EsTreeNode, traceDepth + 1)
    );
  }
  if (subtreeReferencesIdentifierName(inner, COMPUTED_STYLE_READ_NAMES)) return true;
  if (!isNodeOfType(inner, "Identifier") && !isNodeOfType(inner, "MemberExpression")) {
    return false;
  }
  const rootIdentifier = findRootIdentifier(inner);
  if (!rootIdentifier) return false;
  if (isThemeTokenReference(rootIdentifier)) return false;
  const binding = findVariableInitializer(rootIdentifier, rootIdentifier.name);
  if (!binding) return false;
  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (declarator && declarator.init) {
    return canCarryCssCustomProperty(declarator.init as EsTreeNode, traceDepth + 1);
  }
  return !declarator && isFunctionLike(binding.scopeOwner);
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
// `location.href` / `location.toString()` / `String(location)` on any Location
// reference (NOT `.pathname`/`.search`/`.hash`, which are not absolute URLs
// and DO throw), `document.URL`, `import.meta.url`, a framework request's own
// `.url`, and a live-URL accessor call on a known receiver. Each arm requires
// the exact shape so a user-controlled deep chain (`request.body.url`) still
// gets flagged.
const isValidUrlStringSource = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "CallExpression")) {
    if (
      node.arguments.length === 1 &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "String"
    ) {
      const stringifiedArgument = node.arguments[0];
      return Boolean(
        stringifiedArgument &&
        isLocationObjectReference(stripParenExpression(stringifiedArgument as EsTreeNode)),
      );
    }
    if (
      node.arguments.length !== 0 ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      node.callee.computed ||
      !isNodeOfType(node.callee.property, "Identifier")
    ) {
      return false;
    }
    if (node.callee.property.name === "toString") {
      return isLocationObjectReference(node.callee.object);
    }
    return (
      node.callee.property.name === "url" &&
      isNodeOfType(node.callee.object, "Identifier") &&
      LIVE_URL_ACCESSOR_RECEIVERS.has(node.callee.object.name)
    );
  }
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return false;
  if (!isNodeOfType(node.property, "Identifier")) return false;
  const propertyName = node.property.name;
  if (propertyName === "href") return isLocationObjectReference(node.object);
  // `location.origin` is a spec-guaranteed valid `scheme://host[:port]`.
  if (propertyName === "origin") return isLocationObjectReference(node.object);
  if (propertyName === "URL") {
    return isNodeOfType(node.object, "Identifier") && node.object.name === "document";
  }
  if (propertyName === "url") {
    if (isNodeOfType(node.object, "MetaProperty")) return true;
    return isNodeOfType(node.object, "Identifier") && REQUEST_URL_ROOTS.has(node.object.name);
  }
  // Next.js middleware's `request.nextUrl` is a NextURL — a URL-shaped object
  // whose stringification is the already-parsed incoming request URL.
  if (propertyName === "nextUrl") {
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
  if (isSearchParamsSerialization(inner, traceDepth)) return false;
  if (isNodeOfType(inner, "AwaitExpression")) {
    return isUntrustedUrlArgument(inner.argument as EsTreeNode, traceDepth + 1);
  }
  // A conditional is untrusted only when one of its BRANCHES is — the test
  // (`/^https?:/.test(file.url) ? file.url : fallback`) never flows into the
  // parsed value.
  if (isNodeOfType(inner, "ConditionalExpression")) {
    return (
      isUntrustedUrlArgument(inner.consequent as EsTreeNode, traceDepth + 1) ||
      isUntrustedUrlArgument(inner.alternate as EsTreeNode, traceDepth + 1)
    );
  }
  if (isNodeOfType(inner, "LogicalExpression")) {
    return (
      isUntrustedUrlArgument(inner.left as EsTreeNode, traceDepth + 1) ||
      isUntrustedUrlArgument(inner.right as EsTreeNode, traceDepth + 1)
    );
  }
  if (isNodeOfType(inner, "TemplateLiteral")) {
    // `${location.origin}/${rest}` — a template that STARTS with a valid
    // origin source followed by a literal `/` is a valid absolute URL no
    // matter what the remaining expressions hold (percent-encoded, never
    // rejected), mirroring ABSOLUTE_ORIGIN_PREFIX_PATTERN for literals.
    const firstQuasiRaw = inner.quasis[0]?.value?.raw ?? "";
    const firstExpression = inner.expressions[0];
    const followingQuasiRaw = inner.quasis[1]?.value?.raw ?? "";
    if (
      firstQuasiRaw === "" &&
      firstExpression &&
      isAlwaysValidUrlArgument(stripParenExpression(firstExpression as EsTreeNode)) &&
      followingQuasiRaw.startsWith("/")
    ) {
      return false;
    }
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
    // A bare parameter (or untraceable binding) merely NAMED `url`/`path` is
    // not evidence of runtime-malformed input — only fire when the value
    // traces to a route/query/location/request source.
    return false;
  }
  const rootName = getRootIdentifierName(inner, { followCallChains: true });
  if (rootName && URL_UNTRUSTED_ROOT_NAMES.has(rootName)) return true;
  // A call's RETURN value is a different value from its arguments — do not
  // taint `resolveUrl(client, params.x)` because `params` appears in an
  // argument. Only the callee chain (`params.get(...)`, covered by the root
  // check above) carries taint through a call.
  if (isNodeOfType(inner, "CallExpression")) {
    return subtreeReferencesIdentifierName(inner.callee as EsTreeNode, URL_ROUTE_SOURCE_ROOTS);
  }
  return subtreeReferencesIdentifierName(inner, URL_ROUTE_SOURCE_ROOTS);
};

const dottedMemberChainPath = (node: EsTreeNode): string | null => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "Identifier")) return inner.name;
  if (
    isNodeOfType(inner, "MemberExpression") &&
    !inner.computed &&
    isNodeOfType(inner.property, "Identifier")
  ) {
    const objectPath = dottedMemberChainPath(inner.object as EsTreeNode);
    return objectPath ? `${objectPath}.${inner.property.name}` : null;
  }
  return null;
};

const isNullOrUndefinedComparand = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "Literal")) return inner.value === null;
  return isNodeOfType(inner, "Identifier") && inner.name === "undefined";
};

// The express-http-proxy option-bag shape: the parsed member chain is exact-
// equality-checked against allowlist values in a SIBLING callback of the same
// call — `proxy(req => new URL(req.query.url).origin, { filter: req =>
// urls.some(url => req.query?.url === url) })` — so the resolver only ever
// parses a value the gate admitted. Requires a dotted chain: a bare
// identifier equality (`refererRawUrl === null`) is a null check, not an
// allowlist, and null/undefined comparands never count.
const isEqualityAllowlistedInEnclosingCall = (
  parseNode: EsTreeNode,
  argument: EsTreeNode,
): boolean => {
  const argumentPath = dottedMemberChainPath(argument);
  if (!argumentPath || !argumentPath.includes(".")) return false;
  let ancestor: EsTreeNode | null | undefined = parseNode.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "CallExpression")) {
      let didFindAllowlistComparison = false;
      walkAst(ancestor, (child: EsTreeNode) => {
        if (didFindAllowlistComparison) return false;
        if (child === parseNode) return false;
        if (
          isNodeOfType(child, "BinaryExpression") &&
          child.operator === "===" &&
          !isNullOrUndefinedComparand(child.left as EsTreeNode) &&
          !isNullOrUndefinedComparand(child.right as EsTreeNode) &&
          (dottedMemberChainPath(child.left as EsTreeNode) === argumentPath ||
            dottedMemberChainPath(child.right as EsTreeNode) === argumentPath)
        ) {
          didFindAllowlistComparison = true;
          return false;
        }
      });
      if (didFindAllowlistComparison) return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const isSupportedColorParserReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const importSource = getImportSourceForName(identifier, identifier.name);
  return (
    (importSource !== null && COLOR_PARSER_MODULE_NAMES.has(importSource)) ||
    context.scopes.isGlobalReference(identifier)
  );
};

const expressionsReferenceSameValue = (left: EsTreeNode, right: EsTreeNode): boolean => {
  const leftPath = dottedMemberChainPath(left);
  return leftPath !== null && leftPath === dottedMemberChainPath(right);
};

const isMatchingValidityCheck = (
  node: EsTreeNode,
  parserKind: "url" | "color",
  parsedArgument: EsTreeNode,
  context: RuleContext,
): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "CallExpression") || !isNodeOfType(inner.callee, "MemberExpression")) {
    return false;
  }
  const receiver = stripParenExpression(inner.callee.object as EsTreeNode);
  const methodName = getStaticPropertyName(inner.callee);
  const firstArgument = inner.arguments[0];
  if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return false;
  if (!expressionsReferenceSameValue(firstArgument as EsTreeNode, parsedArgument)) return false;
  if (parserKind === "url") {
    return (
      methodName === "canParse" &&
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "URL" &&
      context.scopes.isGlobalReference(receiver)
    );
  }
  return (
    methodName === "valid" &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "chroma" &&
    isSupportedColorParserReference(receiver, context)
  );
};

const validityCheckPolarity = (
  node: EsTreeNode,
  parserKind: "url" | "color",
  parsedArgument: EsTreeNode,
  context: RuleContext,
): boolean | null => {
  const inner = stripParenExpression(node);
  if (isMatchingValidityCheck(inner, parserKind, parsedArgument, context)) return true;
  if (
    isNodeOfType(inner, "UnaryExpression") &&
    inner.operator === "!" &&
    isMatchingValidityCheck(inner.argument as EsTreeNode, parserKind, parsedArgument, context)
  ) {
    return false;
  }
  return null;
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
const isGuardedByValidityCheck = (
  node: EsTreeNode,
  parserKind: "url" | "color",
  parsedArgument: EsTreeNode,
  context: RuleContext,
): boolean => {
  let cursor: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (
      isNodeOfType(parent, "IfStatement") &&
      parent.consequent === cursor &&
      validityCheckPolarity(parent.test, parserKind, parsedArgument, context) === true
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      ((parent.consequent === cursor &&
        validityCheckPolarity(parent.test, parserKind, parsedArgument, context) === true) ||
        (parent.alternate === cursor &&
          validityCheckPolarity(parent.test, parserKind, parsedArgument, context) === false))
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === cursor &&
      validityCheckPolarity(parent.left, parserKind, parsedArgument, context) === true
    ) {
      return true;
    }
    if (isNodeOfType(parent, "BlockStatement") || isNodeOfType(parent, "Program")) {
      for (const statement of parent.body) {
        if (statement === cursor) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          validityCheckPolarity(statement.test, parserKind, parsedArgument, context) === false &&
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
  tags: ["test-noise"],
  recommendation:
    "`decodeURIComponent`/`decodeURI`, color parsers (`readableColor`/`parseToRgb`/`chroma`), and single-arg `new URL(x)` on a URL/route value throw on malformed runtime input and crash render; guard with a validity pre-check (`URL.canParse`, `chroma.valid`), a try/catch, or a `safe*` helper that returns a fallback.",
  create: (context: RuleContext) => {
    const filename = context.filename ?? "";
    const fileIsExcluded = EXCLUDED_FILE_PATTERN.test(filename);
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (fileIsExcluded) return;
        if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "URL") return;
        if (!context.scopes.isGlobalReference(node.callee)) return;
        if (node.arguments.length !== 1) return;
        const argument = node.arguments[0];
        if (!argument) return;
        if (isCompileTimeOrModuleConst(argument as EsTreeNode)) return;
        if (isAlwaysValidUrlArgument(argument as EsTreeNode)) return;
        if (!isUntrustedUrlArgument(argument as EsTreeNode, 0)) return;
        if (isInsideTryStatement(node as EsTreeNode)) return;
        if (isRoutedThroughSafeHelper(node as EsTreeNode)) return;
        if (isGuardedByValidityCheck(node as EsTreeNode, "url", argument as EsTreeNode, context))
          return;
        if (isEqualityAllowlistedInEnclosingCall(node as EsTreeNode, argument as EsTreeNode)) {
          return;
        }
        context.report({ node: node as EsTreeNode, message: URL_MESSAGE });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (fileIsExcluded) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const calleeName = node.callee.name;
        const isDecode =
          DECODE_CALLEE_NAMES.has(calleeName) && context.scopes.isGlobalReference(node.callee);
        const isColor =
          COLOR_CALLEE_NAMES.has(calleeName) &&
          isSupportedColorParserReference(node.callee, context);
        if (!isDecode && !isColor) return;

        const argument = node.arguments[0];
        if (!argument) return;
        if (isInsideTryStatement(node as EsTreeNode)) return;
        if (isRoutedThroughSafeHelper(node as EsTreeNode)) return;

        if (isDecode) {
          if (!argumentTracesToUrlRouteSource(argument as EsTreeNode, context)) return;
          context.report({ node: node as EsTreeNode, message: DECODE_MESSAGE });
          return;
        }

        // Color arm: a runtime color value parsed in a render/hook path.
        if (!canCarryCssCustomProperty(argument as EsTreeNode, 0)) return;
        if (!hasEnclosingFunction(node as EsTreeNode)) return;
        if (isGuardedByValidityCheck(node as EsTreeNode, "color", argument as EsTreeNode, context))
          return;
        context.report({ node: node as EsTreeNode, message: COLOR_MESSAGE });
      },
    };
  },
});
