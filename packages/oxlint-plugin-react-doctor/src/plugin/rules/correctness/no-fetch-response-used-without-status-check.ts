import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getMeaningfulParent } from "../../utils/get-meaningful-parent.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
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
  responseBinding: EsTreeNodeOfType<"Identifier">;
  // `let response; try { response = await fetch(...) } catch {}` leaves the
  // binding undefined on network error, so a `!response` guard is live —
  // only count truthiness guards as dead when the binding is a declarator
  // (or a callback parameter) that always holds a Response.
  responseBindingCanBeUndefined: boolean;
}

const reportUnguarded = ({
  context,
  reportNode,
  responseBinding,
  responseBindingCanBeUndefined,
}: UnguardedReportInput): void => {
  const symbol = context.scopes.symbolFor(responseBinding);
  if (!symbol) return;
  const isConditionUse = (candidate: EsTreeNode): boolean => {
    let current = findTransparentExpressionRoot(candidate);
    while (current.parent) {
      const parent = current.parent;
      if (
        (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
        isNodeOfType(parent, "BinaryExpression") ||
        isNodeOfType(parent, "LogicalExpression")
      ) {
        current = parent;
        continue;
      }
      return Boolean(
        (isNodeOfType(parent, "IfStatement") && parent.test === current) ||
        (isNodeOfType(parent, "ConditionalExpression") && parent.test === current) ||
        ((isNodeOfType(parent, "WhileStatement") ||
          isNodeOfType(parent, "DoWhileStatement") ||
          isNodeOfType(parent, "ForStatement")) &&
          parent.test === current) ||
        (isNodeOfType(parent, "SwitchStatement") && parent.discriminant === current),
      );
    }
    return false;
  };
  const consumeCallForReference = (identifier: EsTreeNode): EsTreeNode | null => {
    const receiver = findTransparentExpressionRoot(identifier);
    const member = receiver.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier") ||
      !BODY_CONSUMER_METHODS.has(member.property.name)
    ) {
      return null;
    }
    const call = getMeaningfulParent(member);
    return call && isNodeOfType(call, "CallExpression") && call.callee === member ? call : null;
  };
  const consumptions = symbol.references
    .map((reference) => consumeCallForReference(reference.identifier))
    .filter((candidate): candidate is EsTreeNode => candidate !== null);
  if (!responseBindingCanBeUndefined) {
    for (const reference of symbol.references) {
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (
        parent &&
        isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "!" &&
        isConditionUse(parent)
      ) {
        consumptions.push(parent);
      }
    }
  }
  const firstConsumption = consumptions.toSorted(
    (left, right) => left.range[0] - right.range[0],
  )[0];
  if (!firstConsumption) return;

  const statusGuardDominates = symbol.references.some((reference) => {
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    return Boolean(
      member &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === receiver &&
      !member.computed &&
      isNodeOfType(member.property, "Identifier") &&
      STATUS_CHECK_PROPERTIES.has(member.property.name) &&
      isConditionUse(member) &&
      nodeDominatesNode(member, firstConsumption, context),
    );
  });
  if (statusGuardDominates) return;

  const destructuredStatusGuardDominates = symbol.references.some((reference) => {
    const declarator = reference.identifier.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== reference.identifier ||
      !isNodeOfType(declarator.id, "ObjectPattern")
    ) {
      return false;
    }
    return declarator.id.properties.some((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        !isNodeOfType(property.key, "Identifier") ||
        !STATUS_CHECK_PROPERTIES.has(property.key.name) ||
        !isNodeOfType(property.value, "Identifier")
      ) {
        return false;
      }
      const statusSymbol = context.scopes.symbolFor(property.value);
      return Boolean(
        statusSymbol?.references.some(
          (statusReference) =>
            isConditionUse(statusReference.identifier) &&
            nodeDominatesNode(statusReference.identifier, firstConsumption, context),
        ),
      );
    });
  });
  if (destructuredStatusGuardDominates) return;

  const validatorDominates = symbol.references.some((reference) => {
    const parent = reference.identifier.parent;
    if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
    if (!parent.arguments.some((argument) => argument === reference.identifier)) return false;
    const callee = stripGroupingParens(parent.callee as EsTreeNode);
    let validatorName: string | null = null;
    if (isNodeOfType(callee, "Identifier")) {
      validatorName = callee.name;
    } else if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier")
    ) {
      validatorName = callee.property.name;
    }
    return Boolean(
      validatorName &&
      /^(?:assert|check|ensure|require|throw|validate)/i.test(validatorName) &&
      nodeDominatesNode(parent, firstConsumption, context),
    );
  });
  if (validatorDominates) return;
  context.report({ node: reportNode, message: MESSAGE });
};

// Flags consuming a global-`fetch` Response without an `ok`/`status`
// check: `.json()`/`.text()`/`.blob()` (or a truthiness test on the
// Response, which is always truthy) with no preceding `response.ok` /
// `response.status`. `fetch` resolves on 4xx/5xx, so the error body is
// parsed as success. Roots only at the literal global `fetch`. A status
// guard or validator must use the same binding and dominate consumption.
// Local `data:`/`blob:` schemes and bundler-emitted asset URLs are inert,
// and non-production files remain excluded by the rule's tags and build
// script filter.
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
          if (isDiscardedChainWithRejectionHandler(node as EsTreeNode)) return;
          reportUnguarded({
            context,
            reportNode: node as EsTreeNode,
            responseBinding: firstParam as EsTreeNodeOfType<"Identifier">,
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
            context.report({ node: node as EsTreeNode, message: MESSAGE });
            return;
          }

          // const response = await fetch(...)
          let responseBinding: EsTreeNodeOfType<"Identifier"> | null = null;
          let responseBindingCanBeUndefined = false;
          if (
            isNodeOfType(afterAwait, "VariableDeclarator") &&
            isNodeOfType(afterAwait.id, "Identifier")
          ) {
            responseBinding = afterAwait.id;
          } else if (
            isNodeOfType(afterAwait, "AssignmentExpression") &&
            isNodeOfType(afterAwait.left, "Identifier")
          ) {
            responseBinding = afterAwait.left;
            responseBindingCanBeUndefined = true;
          }
          if (!responseBinding) return;
          reportUnguarded({
            context,
            reportNode: node as EsTreeNode,
            responseBinding,
            responseBindingCanBeUndefined,
          });
        }
      },
    };
  },
});
