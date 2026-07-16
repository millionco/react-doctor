import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getMeaningfulParent } from "../../utils/get-meaningful-parent.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const BODY_CONSUMER_METHODS = new Set(["json", "text", "blob", "arrayBuffer", "formData"]);
const STATUS_CHECK_PROPERTIES = new Set(["ok", "status"]);
const PROMISE_CHAIN_METHODS = new Set(["then", "catch", "finally"]);
// `data:` / `blob:` URLs decode in-process — they can never produce an
// HTTP 4xx/5xx, so the Response is always ok and a status check is noise.
const INERT_URL_SCHEME_PATTERN = /^(?:data|blob):/i;
const MAX_URL_BINDING_RESOLUTION_DEPTH = 4;
// Build-time scripts (Gatsby node APIs, *.config.* files) run once at
// build and fail the build loudly on a bad response — not user-facing.
const BUILD_SCRIPT_BASENAME_PATTERN = /^gatsby-(?:node|config|ssr|browser)\.|\.config\./i;

const MESSAGE =
  "`fetch()` resolves (does not reject) on HTTP 4xx/5xx, so consuming this Response without checking `response.ok`/`response.status` parses an error body as success or crashes on a truthiness guard that is always true. Check `if (!response.ok) throw ...` before reading `.json()`/`.text()`/`.blob()`.";

const getTransparentExpressionParent = (node: EsTreeNode): EsTreeNode | null =>
  findTransparentExpressionRoot(node).parent ?? null;

const isGlobalFetchCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "Identifier") || callee.name !== "fetch") return false;
  // An imported / aliased / locally-bound `fetch` is a wrapper whose
  // status check the detector can't see; only root at the DOM global.
  if (findVariableInitializer(callee, "fetch")) return false;
  return true;
};

const resolveStaticUrlPrefix = (argument: EsTreeNode, depth: number): string | null => {
  if (depth > MAX_URL_BINDING_RESOLUTION_DEPTH) return null;
  const expression = stripGroupingParens(argument);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  if (isNodeOfType(expression, "BinaryExpression") && expression.operator === "+") {
    return resolveStaticUrlPrefix(expression.left as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer || binding.initializer === expression) return null;
    return resolveStaticUrlPrefix(binding.initializer, depth + 1);
  }
  return null;
};

// data:/blob: URLs produced by calls rather than literals —
// `canvas.toDataURL(...)`, `URL.createObjectURL(...)` — or carried by a
// binding/parameter named for the scheme (`dataUrl`, `objectUrl`,
// `blobUrl`). Decoding them is local: no HTTP status exists to check.
// A `require('./asset.md')` URL is inert the same way: the bundler emits
// the asset into the app's own bundle, so the same-origin static URL
// cannot 4xx/5xx in a consistent deployment.
const INERT_URL_PRODUCER_METHOD_NAMES = new Set(["toDataURL", "createObjectURL"]);
const INERT_URL_PRODUCER_CALLEE_NAMES = new Set(["createObjectURL", "require"]);
const INERT_URL_BINDING_NAME_PATTERN = /^(?:data|object|blob)_?ur[il]$/i;

const isBundledAssetRequireCall = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === "require";

// `let markdownPath = ''; try { markdownPath = require(...) } catch {
// markdownPath = require(fallback) }` — the require-produced URL reaches
// the binding through assignments rather than the declarator initializer.
const bindingIsAssignedFromRequire = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  let assignedFromRequire = false;
  walkAst(binding.scopeOwner, (child) => {
    if (assignedFromRequire) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === identifier.name &&
      isBundledAssetRequireCall(stripGroupingParens(child.right as EsTreeNode))
    ) {
      assignedFromRequire = true;
      return false;
    }
  });
  return assignedFromRequire;
};

// `new URL('./asset.ttf', import.meta.url)` — the bundler resolves the
// relative specifier against the module's own emitted location (the next/og
// font idiom), so the fetched bytes are the app's own bundled asset: no
// meaningful HTTP status exists to branch on.
const isImportMetaUrlAssetUrl = (expression: EsTreeNode): boolean => {
  if (!isNodeOfType(expression, "NewExpression")) return false;
  if (!isNodeOfType(expression.callee, "Identifier") || expression.callee.name !== "URL") {
    return false;
  }
  const baseArgument = expression.arguments?.[1];
  if (!baseArgument) return false;
  const base = stripGroupingParens(baseArgument as EsTreeNode);
  return (
    isNodeOfType(base, "MemberExpression") &&
    !base.computed &&
    isNodeOfType(base.object, "MetaProperty") &&
    isNodeOfType(base.property, "Identifier") &&
    base.property.name === "url"
  );
};

const isInertUrlProducer = (argument: EsTreeNode, depth: number): boolean => {
  if (depth > MAX_URL_BINDING_RESOLUTION_DEPTH) return false;
  const expression = stripGroupingParens(argument);
  if (isImportMetaUrlAssetUrl(expression)) return true;
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripGroupingParens(expression.callee as EsTreeNode);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier")
    ) {
      return INERT_URL_PRODUCER_METHOD_NAMES.has(callee.property.name);
    }
    return isNodeOfType(callee, "Identifier") && INERT_URL_PRODUCER_CALLEE_NAMES.has(callee.name);
  }
  if (isNodeOfType(expression, "Identifier")) {
    if (INERT_URL_BINDING_NAME_PATTERN.test(expression.name)) return true;
    if (bindingIsAssignedFromRequire(expression)) return true;
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer || binding.initializer === expression) return false;
    return isInertUrlProducer(binding.initializer, depth + 1);
  }
  return false;
};

const fetchesInertUrlScheme = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return false;
  const urlPrefix = resolveStaticUrlPrefix(firstArgument as EsTreeNode, 0);
  if (urlPrefix !== null && INERT_URL_SCHEME_PATTERN.test(urlPrefix)) return true;
  return isInertUrlProducer(firstArgument as EsTreeNode, 0);
};

const nearestFunctionOrProgram = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent ?? null;
  while (ancestor) {
    if (isFunctionLike(ancestor) || isNodeOfType(ancestor, "Program")) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const functionRebindsName = (functionNode: EsTreeNode, name: string): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const parameterNames = new Set<string>();
  for (const parameter of functionNode.params ?? []) {
    collectPatternNames(parameter as EsTreeNode, parameterNames);
  }
  if (parameterNames.has(name)) return true;
  let didRebind = false;
  walkAst(functionNode.body as EsTreeNode, (child) => {
    if (didRebind) return false;
    if (isNodeOfType(child, "VariableDeclarator")) {
      const declaredNames = new Set<string>();
      collectPatternNames(child.id as EsTreeNode, declaredNames);
      if (declaredNames.has(name)) {
        didRebind = true;
        return false;
      }
    }
  });
  return didRebind;
};

// Walks `scope` without descending into nested functions that rebind
// `responseName` — a shadowed inner `response` is a different variable,
// so its checks/consumes must not be attributed to the outer Response.
const walkScopeSkippingShadows = (
  scope: EsTreeNode,
  responseName: string,
  visitor: (child: EsTreeNode) => boolean | void,
): void => {
  walkAst(scope, (child) => {
    if (child !== scope && isFunctionLike(child) && functionRebindsName(child, responseName)) {
      return false;
    }
    return visitor(child);
  });
};

const isBodyConsumeCall = (node: EsTreeNode, responseName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : null;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === responseName &&
    isNodeOfType(callee.property, "Identifier") &&
    BODY_CONSUMER_METHODS.has(callee.property.name)
  );
};

const isTruthinessTest = (node: EsTreeNode, responseName: string): boolean =>
  isNodeOfType(node, "UnaryExpression") &&
  node.operator === "!" &&
  isNodeOfType(node.argument, "Identifier") &&
  node.argument.name === responseName;

const scopeConsumesResponse = (
  scope: EsTreeNode,
  responseName: string,
  countTruthinessGuard: boolean,
): boolean => {
  let found = false;
  walkScopeSkippingShadows(scope, responseName, (child) => {
    if (found) return false;
    if (
      isBodyConsumeCall(child, responseName) ||
      (countTruthinessGuard && isTruthinessTest(child, responseName))
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const isStatusMemberAccess = (node: EsTreeNode, responseName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === responseName &&
  isNodeOfType(node.property, "Identifier") &&
  STATUS_CHECK_PROPERTIES.has(node.property.name);

// `const { ok, status } = response` is a status check performed through
// destructuring rather than member access.
const isStatusDestructuring = (node: EsTreeNode, responseName: string): boolean => {
  if (!isNodeOfType(node, "VariableDeclarator") || !isNodeOfType(node.id, "ObjectPattern")) {
    return false;
  }
  if (!node.init) return false;
  const initializer = stripGroupingParens(node.init as EsTreeNode);
  if (!isNodeOfType(initializer, "Identifier") || initializer.name !== responseName) return false;
  return (node.id.properties ?? []).some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      STATUS_CHECK_PROPERTIES.has(property.key.name),
  );
};

const scopeChecksStatus = (scope: EsTreeNode, responseName: string): boolean => {
  let found = false;
  walkScopeSkippingShadows(scope, responseName, (child) => {
    if (found) return false;
    if (isStatusMemberAccess(child, responseName) || isStatusDestructuring(child, responseName)) {
      found = true;
      return false;
    }
  });
  return found;
};

// APIs that tunnel the HTTP status through the body (`{ status: 201 }` /
// `{ statusCode: 400 }`) get checked on the PARSED value instead of the
// Response: `const parsed = await response.json(); if (parsed.status !== 201)
// throw ...`. That is the ok-check, just one hop later.
const PARSED_BODY_STATUS_PROPERTIES = new Set(["ok", "status", "statusCode"]);

const isParsedBodyStatusAccess = (node: EsTreeNode, parsedName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === parsedName &&
  isNodeOfType(node.property, "Identifier") &&
  PARSED_BODY_STATUS_PROPERTIES.has(node.property.name);

const scopeChecksParsedBodyStatus = (scope: EsTreeNode, responseName: string): boolean => {
  const parsedNames = new Set<string>();
  walkScopeSkippingShadows(scope, responseName, (child) => {
    if (!isNodeOfType(child, "VariableDeclarator") || !isNodeOfType(child.id, "Identifier")) {
      return;
    }
    if (!child.init) return;
    let initializer = stripGroupingParens(child.init as EsTreeNode);
    if (isNodeOfType(initializer, "AwaitExpression")) {
      initializer = stripGroupingParens(initializer.argument as EsTreeNode);
    }
    if (isBodyConsumeCall(initializer, responseName)) parsedNames.add(child.id.name);
  });
  if (parsedNames.size === 0) return false;
  let found = false;
  walkScopeSkippingShadows(scope, responseName, (child) => {
    if (found) return false;
    for (const parsedName of parsedNames) {
      if (isParsedBodyStatusAccess(child, parsedName)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

const isConsumingReceiver = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === identifier &&
    !parent.computed &&
    isNodeOfType(parent.property, "Identifier") &&
    (BODY_CONSUMER_METHODS.has(parent.property.name) ||
      STATUS_CHECK_PROPERTIES.has(parent.property.name)),
  );
};

const isPassedAsCallArgument = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (!isNodeOfType(parent, "CallExpression") && !isNodeOfType(parent, "NewExpression")) {
    return false;
  }
  if (parent.callee === identifier) return false;
  return (parent.arguments ?? []).some((argument) => argument === identifier);
};

// The Response escapes the scope — returned to a caller
// (`return response` / `return { response }`) or handed to another
// function (`assertOk(response)`, the throw-on-error validator idiom) —
// so its status check is legitimately deferred to the receiver.
const scopeResponseEscapes = (scope: EsTreeNode, responseName: string): boolean => {
  let found = false;
  walkScopeSkippingShadows(scope, responseName, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      walkAst(child.argument as EsTreeNode, (inner) => {
        if (found) return false;
        if (
          isNodeOfType(inner, "Identifier") &&
          inner.name === responseName &&
          !isConsumingReceiver(inner)
        ) {
          found = true;
          return false;
        }
      });
      if (found) return false;
      return;
    }
    if (
      isNodeOfType(child, "Identifier") &&
      child.name === responseName &&
      isPassedAsCallArgument(child)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const isConsoleCall = (expression: EsTreeNode): boolean => {
  const call = stripGroupingParens(expression);
  return (
    isNodeOfType(call, "CallExpression") &&
    isNodeOfType(call.callee, "MemberExpression") &&
    isNodeOfType(call.callee.object, "Identifier") &&
    call.callee.object.name === "console"
  );
};

const isLoggingOnlyStatement = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "ExpressionStatement") &&
  isConsoleCall(statement.expression as EsTreeNode);

// An EMPTY handler (`catch {}`, `.catch(() => {})`) is a deliberate
// fail-open swallow — unlike a log-only handler (probably an oversight),
// nobody writes an empty handler expecting the failure to surface.
const statementsMaterializeError = (statements: ReadonlyArray<EsTreeNode>): boolean =>
  statements.length === 0 || statements.some((statement) => !isLoggingOnlyStatement(statement));

// A rejection handler "materializes" the failure when it does more than
// log — sets error state, returns a fallback value, rethrows. A named
// handler reference is trusted the same way (its body is out of view but
// it exists to handle the failure).
const isErrorMaterializingHandler = (handlerExpression: EsTreeNode): boolean => {
  const handler = stripGroupingParens(handlerExpression);
  if (!isFunctionLike(handler)) {
    return isNodeOfType(handler, "Identifier") || isNodeOfType(handler, "MemberExpression");
  }
  if (isNodeOfType(handler.body, "BlockStatement")) {
    return statementsMaterializeError(handler.body.body ?? []);
  }
  return Boolean(handler.body) && !isConsoleCall(handler.body as EsTreeNode);
};

// Walks the member-call chain rooted at the fetch CallExpression looking
// for a `.catch(fn)` link (or a two-argument `.then(fn, rejectionFn)`)
// whose handler materializes the failure — the dominant real-world shape
// where the author already routes fetch errors somewhere visible.
const chainMaterializesRejection = (fetchCall: EsTreeNode): boolean => {
  let chainLink: EsTreeNode = fetchCall;
  while (true) {
    const member = getTransparentExpressionParent(chainLink);
    const methodName =
      member &&
      isNodeOfType(member, "MemberExpression") &&
      isNodeOfType(member.property, "Identifier")
        ? member.property.name
        : null;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripParenExpression(member.object as EsTreeNode) !== chainLink ||
      member.computed ||
      methodName === null ||
      !PROMISE_CHAIN_METHODS.has(methodName)
    ) {
      return false;
    }
    const chainCall = getTransparentExpressionParent(member);
    if (
      !chainCall ||
      !isNodeOfType(chainCall, "CallExpression") ||
      stripGroupingParens(chainCall.callee as EsTreeNode) !== member
    ) {
      return false;
    }
    const chainArguments = chainCall.arguments ?? [];
    if (
      methodName === "catch" &&
      chainArguments[0] &&
      isErrorMaterializingHandler(chainArguments[0] as EsTreeNode)
    ) {
      return true;
    }
    if (
      methodName === "then" &&
      chainArguments[1] &&
      isErrorMaterializingHandler(chainArguments[1] as EsTreeNode)
    ) {
      return true;
    }
    chainLink = chainCall;
  }
};

const outermostPromiseChainCall = (fetchCall: EsTreeNode): EsTreeNode => {
  let chainLink: EsTreeNode = fetchCall;
  while (true) {
    const member = getTransparentExpressionParent(chainLink);
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripParenExpression(member.object as EsTreeNode) !== chainLink ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier") ||
      !PROMISE_CHAIN_METHODS.has(member.property.name)
    ) {
      return chainLink;
    }
    const chainCall = getTransparentExpressionParent(member);
    if (
      !chainCall ||
      !isNodeOfType(chainCall, "CallExpression") ||
      stripGroupingParens(chainCall.callee as EsTreeNode) !== member
    ) {
      return chainLink;
    }
    chainLink = chainCall;
  }
};

// A `try { ... await fetch ... } catch` whose catch clause materializes
// the failure covers the awaited Response the same way a `.catch` link
// covers a promise chain.
const enclosingTryMaterializesErrors = (node: EsTreeNode): boolean => {
  let current: EsTreeNode = node;
  let ancestor = node.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === current &&
      ancestor.handler &&
      isNodeOfType(ancestor.handler, "CatchClause") &&
      statementsMaterializeError(ancestor.handler.body?.body ?? [])
    ) {
      return true;
    }
    current = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const PROMISE_COMBINATOR_NAMES = new Set(["all", "race", "any", "allSettled"]);

// `await fetch(...).then(...)` inside a materializing try-catch: the
// await routes the chain's rejection into the catch clause, so the
// failure is covered the same way the awaited-declarator shapes are.
// Without the await the try never sees the rejection, so it exempts
// nothing. A chain sitting as an ELEMENT of `Promise.all([...])` /
// `Promise.race([...])` is covered the same way when the combinator's
// await sits under the materializing try — the combinator forwards the
// element's rejection.
const awaitedChainCoveredByMaterializingTry = (fetchCall: EsTreeNode): boolean => {
  let chainConsumer = getMeaningfulParent(outermostPromiseChainCall(fetchCall));
  if (chainConsumer && isNodeOfType(chainConsumer, "ArrayExpression")) {
    const combinatorCall = getMeaningfulParent(chainConsumer);
    if (
      combinatorCall &&
      isNodeOfType(combinatorCall, "CallExpression") &&
      isNodeOfType(combinatorCall.callee, "MemberExpression") &&
      !combinatorCall.callee.computed &&
      isNodeOfType(combinatorCall.callee.object, "Identifier") &&
      combinatorCall.callee.object.name === "Promise" &&
      isNodeOfType(combinatorCall.callee.property, "Identifier") &&
      PROMISE_COMBINATOR_NAMES.has(combinatorCall.callee.property.name)
    ) {
      chainConsumer = getMeaningfulParent(outermostPromiseChainCall(combinatorCall));
    }
  }
  return Boolean(
    chainConsumer &&
    isNodeOfType(chainConsumer, "AwaitExpression") &&
    enclosingTryMaterializesErrors(chainConsumer),
  );
};

// The fetch lives in a named local async helper whose CALL SITE routes the
// rejection — `load().catch((e) => setError(e))` or `await load()` under a
// materializing try. The failure routing is identical to an inline .catch,
// just one function hop away.
const enclosingHelperCallSiteHandlesRejection = (fetchNode: EsTreeNode): boolean => {
  const enclosing = nearestFunctionOrProgram(fetchNode);
  if (!enclosing || !isFunctionLike(enclosing) || !enclosing.async) return false;
  let helperName: string | null = null;
  if (isNodeOfType(enclosing, "FunctionDeclaration") && isNodeOfType(enclosing.id, "Identifier")) {
    helperName = enclosing.id.name;
  } else {
    const declarator = enclosing.parent;
    if (
      isNodeOfType(declarator, "VariableDeclarator") &&
      isNodeOfType(declarator.id, "Identifier")
    ) {
      helperName = declarator.id.name;
    }
  }
  if (!helperName) return false;
  const outerScope = nearestFunctionOrProgram(enclosing);
  if (!outerScope) return false;
  let isHandled = false;
  walkAst(outerScope, (child: EsTreeNode) => {
    if (isHandled) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripGroupingParens(child.callee as EsTreeNode);
    if (!isNodeOfType(callee, "Identifier") || callee.name !== helperName) return;
    if (chainMaterializesRejection(child)) {
      isHandled = true;
      return false;
    }
    const consumer = getMeaningfulParent(outermostPromiseChainCall(child));
    if (
      consumer &&
      isNodeOfType(consumer, "AwaitExpression") &&
      enclosingTryMaterializesErrors(consumer)
    ) {
      isHandled = true;
      return false;
    }
  });
  return isHandled;
};

// A `.then` handler that only DRAINS the body — an expression-bodied arrow
// returning `param.blob()`/`param.json()`/… or the bare param — never acts
// on the parsed value, so a bad status cannot masquerade as success.
const isPureDrainHandler = (handlerExpression: EsTreeNode): boolean => {
  const handler = stripGroupingParens(handlerExpression);
  if (!isFunctionLike(handler) || isNodeOfType(handler.body, "BlockStatement")) return false;
  const firstParam = handler.params?.[0];
  if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return false;
  const parameterName = (firstParam as EsTreeNodeOfType<"Identifier">).name;
  const body = stripGroupingParens(handler.body as EsTreeNode);
  if (isNodeOfType(body, "Identifier") && body.name === parameterName) return true;
  return isBodyConsumeCall(body, parameterName);
};

// A fire-and-forget prefetch: the whole chain is a discarded statement
// expression, every `.then` handler only drains the body, and a rejection
// handler exists (even an empty swallow). The parsed value never reaches
// state or logic, so draining an error body is harmless — the fetch itself
// is the point (cache warming).
const isDiscardedChainWithRejectionHandler = (fetchCall: EsTreeNode): boolean => {
  const outermost = outermostPromiseChainCall(fetchCall);
  const consumer = getMeaningfulParent(outermost);
  if (consumer && !isNodeOfType(consumer, "ExpressionStatement")) return false;
  let sawRejectionHandler = false;
  let chainLink: EsTreeNode = fetchCall;
  while (true) {
    const member = getMeaningfulParent(chainLink);
    const methodName =
      member &&
      isNodeOfType(member, "MemberExpression") &&
      isNodeOfType(member.property, "Identifier")
        ? member.property.name
        : null;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripGroupingParens(member.object as EsTreeNode) !== chainLink ||
      member.computed ||
      methodName === null ||
      !PROMISE_CHAIN_METHODS.has(methodName)
    ) {
      return sawRejectionHandler;
    }
    const chainCall = getMeaningfulParent(member);
    if (
      !chainCall ||
      !isNodeOfType(chainCall, "CallExpression") ||
      stripGroupingParens(chainCall.callee as EsTreeNode) !== member
    ) {
      return sawRejectionHandler;
    }
    const chainArguments = chainCall.arguments ?? [];
    if (methodName === "then") {
      if (chainArguments[0] && !isPureDrainHandler(chainArguments[0] as EsTreeNode)) {
        return false;
      }
      if (chainArguments[1]) sawRejectionHandler = true;
    }
    if (methodName === "catch" && chainArguments[0]) sawRejectionHandler = true;
    chainLink = chainCall;
  }
};

interface UnguardedReportInput {
  context: RuleContext;
  reportNode: EsTreeNode;
  scope: EsTreeNode;
  responseName: string;
  // `let response; try { response = await fetch(...) } catch {}` leaves the
  // binding undefined on network error, so a `!response` guard is live —
  // only count truthiness guards as dead when the binding is a declarator
  // (or a callback parameter) that always holds a Response.
  responseBindingCanBeUndefined: boolean;
}

const reportUnguarded = ({
  context,
  reportNode,
  scope,
  responseName,
  responseBindingCanBeUndefined,
}: UnguardedReportInput): void => {
  if (!scopeConsumesResponse(scope, responseName, !responseBindingCanBeUndefined)) return;
  if (scopeChecksStatus(scope, responseName)) return;
  if (scopeChecksParsedBodyStatus(scope, responseName)) return;
  if (scopeResponseEscapes(scope, responseName)) return;
  context.report({ node: reportNode, message: MESSAGE });
};

// Flags consuming a global-`fetch` Response without an `ok`/`status`
// check: `.json()`/`.text()`/`.blob()` (or a truthiness test on the
// Response, which is always truthy) with no preceding `response.ok` /
// `response.status`. `fetch` resolves on 4xx/5xx, so the error body is
// parsed as success. Roots only at the literal global `fetch`, and stays
// quiet when the Response escapes to a caller or validator, when a
// `.catch` / two-arg `.then` / enclosing try-catch materializes the
// failure beyond logging (or is a deliberately EMPTY fail-open swallow),
// when the status is checked on the parsed body instead
// (`parsed.status`/`parsed.statusCode`/`parsed.ok`), when the URL is a
// `data:`/`blob:` scheme or a bundler-emitted `require(...)` asset URL
// that can never yield a non-ok response, and in non-production files
// (stories, docs demos, test utilities, build config, gatsby-node
// scripts).
export const noFetchResponseUsedWithoutStatusCheck = defineRule({
  id: "no-fetch-response-used-without-status-check",
  title: "fetch Response consumed without status check",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Check `response.ok` (or `response.status`) before consuming a `fetch` Response with `.json()`/`.text()`/`.blob()`. `fetch` resolves on HTTP 4xx/5xx, so an unchecked response parses the error body as success or crashes on an always-truthy guard.",
  create: (context: RuleContext): RuleVisitors => {
    const normalizedFilename = (context.filename ?? "").replaceAll("\\", "/");
    const basename = normalizedFilename.slice(normalizedFilename.lastIndexOf("/") + 1);
    if (BUILD_SCRIPT_BASENAME_PATTERN.test(basename)) return {};
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isGlobalFetchCall(node)) return;
        if (fetchesInertUrlScheme(node)) return;
        const fetchExpression = findTransparentExpressionRoot(node as EsTreeNode);
        const parent = getMeaningfulParent(fetchExpression);
        if (!parent) return;

        // Shape: fetch(...).then((response) => ...consume...)
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === fetchExpression &&
          !parent.computed &&
          isNodeOfType(parent.property, "Identifier") &&
          parent.property.name === "then"
        ) {
          const thenCall = getMeaningfulParent(parent);
          if (!thenCall || !isNodeOfType(thenCall, "CallExpression")) return;
          const callback = thenCall.arguments?.[0]
            ? stripGroupingParens(thenCall.arguments[0] as EsTreeNode)
            : null;
          if (!callback || !isFunctionLike(callback)) return;
          const firstParam = callback.params?.[0];
          if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return;
          if (chainMaterializesRejection(node as EsTreeNode)) return;
          if (awaitedChainCoveredByMaterializingTry(node as EsTreeNode)) return;
          if (isDiscardedChainWithRejectionHandler(node as EsTreeNode)) return;
          if (enclosingHelperCallSiteHandlesRejection(node as EsTreeNode)) return;
          reportUnguarded({
            context,
            reportNode: node as EsTreeNode,
            scope: callback,
            responseName: (firstParam as EsTreeNodeOfType<"Identifier">).name,
            responseBindingCanBeUndefined: false,
          });
          return;
        }

        // Shape: fetch(...).json() — immediate consume, no status possible.
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === fetchExpression &&
          !parent.computed &&
          isNodeOfType(parent.property, "Identifier") &&
          BODY_CONSUMER_METHODS.has(parent.property.name)
        ) {
          context.report({ node: node as EsTreeNode, message: MESSAGE });
          return;
        }

        if (isNodeOfType(parent, "AwaitExpression")) {
          const afterAwait = getMeaningfulParent(parent);
          if (!afterAwait) return;

          // (await fetch(...)).json()
          if (
            isNodeOfType(afterAwait, "MemberExpression") &&
            stripGroupingParens(afterAwait.object as EsTreeNode) === parent &&
            !afterAwait.computed &&
            isNodeOfType(afterAwait.property, "Identifier") &&
            BODY_CONSUMER_METHODS.has(afterAwait.property.name)
          ) {
            if (enclosingTryMaterializesErrors(parent)) return;
            if (enclosingHelperCallSiteHandlesRejection(node as EsTreeNode)) return;
            context.report({ node: node as EsTreeNode, message: MESSAGE });
            return;
          }

          // const response = await fetch(...)
          let responseName: string | null = null;
          let responseBindingCanBeUndefined = false;
          if (
            isNodeOfType(afterAwait, "VariableDeclarator") &&
            isNodeOfType(afterAwait.id, "Identifier")
          ) {
            responseName = afterAwait.id.name;
          } else if (
            isNodeOfType(afterAwait, "AssignmentExpression") &&
            isNodeOfType(afterAwait.left, "Identifier")
          ) {
            responseName = afterAwait.left.name;
            responseBindingCanBeUndefined = true;
          }
          if (!responseName) return;
          if (enclosingTryMaterializesErrors(parent)) return;
          if (enclosingHelperCallSiteHandlesRejection(node as EsTreeNode)) return;
          const scope = nearestFunctionOrProgram(afterAwait);
          if (!scope) return;
          reportUnguarded({
            context,
            reportNode: node as EsTreeNode,
            scope,
            responseName,
            responseBindingCanBeUndefined,
          });
        }
      },
    };
  },
});
