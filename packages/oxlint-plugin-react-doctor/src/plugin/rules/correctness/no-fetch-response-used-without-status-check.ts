import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// oxc-parser surfaces `(...)` as a node kind outside the TSESTree union,
// so it is matched via a `string`-typed constant.
const PARENTHESIZED_EXPRESSION: string = "ParenthesizedExpression";
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

const meaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION) parent = parent.parent ?? null;
  return parent;
};

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

const fetchesInertUrlScheme = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return false;
  const urlPrefix = resolveStaticUrlPrefix(firstArgument as EsTreeNode, 0);
  return urlPrefix !== null && INERT_URL_SCHEME_PATTERN.test(urlPrefix);
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
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === responseName &&
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

const statementsMaterializeError = (statements: ReadonlyArray<EsTreeNode>): boolean =>
  statements.some((statement) => !isLoggingOnlyStatement(statement));

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
    const member = meaningfulParent(chainLink);
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripGroupingParens(member.object as EsTreeNode) !== chainLink ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier") ||
      !PROMISE_CHAIN_METHODS.has(member.property.name)
    ) {
      return false;
    }
    const chainCall = meaningfulParent(member);
    if (
      !chainCall ||
      !isNodeOfType(chainCall, "CallExpression") ||
      stripGroupingParens(chainCall.callee as EsTreeNode) !== member
    ) {
      return false;
    }
    const chainArguments = chainCall.arguments ?? [];
    if (
      member.property.name === "catch" &&
      chainArguments[0] &&
      isErrorMaterializingHandler(chainArguments[0] as EsTreeNode)
    ) {
      return true;
    }
    if (
      member.property.name === "then" &&
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
    const member = meaningfulParent(chainLink);
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripGroupingParens(member.object as EsTreeNode) !== chainLink ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier") ||
      !PROMISE_CHAIN_METHODS.has(member.property.name)
    ) {
      return chainLink;
    }
    const chainCall = meaningfulParent(member);
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

// `await fetch(...).then(...)` inside a materializing try-catch: the
// await routes the chain's rejection into the catch clause, so the
// failure is covered the same way the awaited-declarator shapes are.
// Without the await the try never sees the rejection, so it exempts
// nothing.
const awaitedChainCoveredByMaterializingTry = (fetchCall: EsTreeNode): boolean => {
  const chainConsumer = meaningfulParent(outermostPromiseChainCall(fetchCall));
  return Boolean(
    chainConsumer &&
    isNodeOfType(chainConsumer, "AwaitExpression") &&
    enclosingTryMaterializesErrors(chainConsumer),
  );
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
// failure beyond logging, when the URL is a `data:`/`blob:` scheme that
// can never yield a non-ok response, and in non-production files
// (stories, demos, tests, build config, gatsby-node scripts).
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
        const parent = meaningfulParent(node as EsTreeNode);
        if (!parent) return;

        // Shape: fetch(...).then((response) => ...consume...)
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === (node as EsTreeNode) &&
          !parent.computed &&
          isNodeOfType(parent.property, "Identifier") &&
          parent.property.name === "then"
        ) {
          const thenCall = meaningfulParent(parent);
          if (!thenCall || !isNodeOfType(thenCall, "CallExpression")) return;
          const callback = thenCall.arguments?.[0]
            ? stripGroupingParens(thenCall.arguments[0] as EsTreeNode)
            : null;
          if (!callback || !isFunctionLike(callback)) return;
          const firstParam = callback.params?.[0];
          if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return;
          if (chainMaterializesRejection(node as EsTreeNode)) return;
          if (awaitedChainCoveredByMaterializingTry(node as EsTreeNode)) return;
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
          parent.object === (node as EsTreeNode) &&
          !parent.computed &&
          isNodeOfType(parent.property, "Identifier") &&
          BODY_CONSUMER_METHODS.has(parent.property.name)
        ) {
          context.report({ node: node as EsTreeNode, message: MESSAGE });
          return;
        }

        if (isNodeOfType(parent, "AwaitExpression")) {
          const afterAwait = meaningfulParent(parent);
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
