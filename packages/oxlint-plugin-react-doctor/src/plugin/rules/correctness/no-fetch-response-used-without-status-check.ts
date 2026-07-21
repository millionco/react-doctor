import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getMeaningfulParent } from "../../utils/get-meaningful-parent.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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
  "`fetch()` resolves (does not reject) on HTTP 4xx/5xx, so this unchecked body read may treat an HTTP error payload like a successful response. Check `response.ok`/`response.status`, or deliberately handle the API's error payload, before reading the body.";

const getTransparentExpressionParent = (node: EsTreeNode): EsTreeNode | null =>
  findTransparentExpressionRoot(node).parent ?? null;

const isGlobalFetchCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "Identifier") || callee.name !== "fetch") return false;
  return context.scopes.isGlobalReference(callee);
};

const resolveStaticUrlPrefix = (
  argument: EsTreeNode,
  depth: number,
  context: RuleContext,
): string | null => {
  if (depth > MAX_URL_BINDING_RESOLUTION_DEPTH) return null;
  const expression = stripGroupingParens(argument);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  if (isNodeOfType(expression, "BinaryExpression") && expression.operator === "+") {
    return resolveStaticUrlPrefix(expression.left as EsTreeNode, depth + 1, context);
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
    if (!initializer || initializer === expression) return null;
    return resolveStaticUrlPrefix(initializer, depth + 1, context);
  }
  return null;
};

// data:/blob: URLs produced by calls rather than literals —
// `canvas.toDataURL(...)`, `URL.createObjectURL(...)` — or carried by a
// local binding. Decoding them is local: no HTTP status exists to check.
// A `require('./asset.md')` URL is inert the same way: the bundler emits
// the asset into the app's own bundle, so the same-origin static URL
// cannot 4xx/5xx in a consistent deployment.
const CANVAS_TYPE_NAMES = new Set(["HTMLCanvasElement", "OffscreenCanvas"]);

const isBundledAssetRequireCall = (expression: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === "require" &&
  context.scopes.isGlobalReference(expression.callee);

// `let markdownPath = ''; try { markdownPath = require(...) } catch {
// markdownPath = require(fallback) }` — the require-produced URL reaches
// the binding through assignments rather than the declarator initializer.
const bindingIsAssignedFromRequire = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return false;
  const writes = symbol.references.filter((reference) => reference.flag !== "read");
  return (
    writes.length > 0 &&
    writes.every((reference) => {
      const assignment = reference.identifier.parent;
      return Boolean(
        assignment &&
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.left === reference.identifier &&
        isBundledAssetRequireCall(stripGroupingParens(assignment.right as EsTreeNode), context),
      );
    })
  );
};

const isProvenCanvasReference = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(expression);
  if (!symbol) return false;
  const binding = symbol.bindingIdentifier;
  const annotation = isNodeOfType(binding, "Identifier") ? binding.typeAnnotation : null;
  if (
    annotation &&
    isNodeOfType(annotation.typeAnnotation, "TSTypeReference") &&
    isNodeOfType(annotation.typeAnnotation.typeName, "Identifier") &&
    CANVAS_TYPE_NAMES.has(annotation.typeAnnotation.typeName.name)
  ) {
    return true;
  }
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const callee = stripGroupingParens(initializer.callee as EsTreeNode);
  const firstArgument = initializer.arguments[0];
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "document" &&
    context.scopes.isGlobalReference(callee.object) &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "createElement" &&
    firstArgument &&
    isNodeOfType(firstArgument, "Literal") &&
    firstArgument.value === "canvas",
  );
};

// `new URL('./asset.ttf', import.meta.url)` — the bundler resolves the
// relative specifier against the module's own emitted location (the next/og
// font idiom), so the fetched bytes are the app's own bundled asset: no
// meaningful HTTP status exists to branch on.
const isImportMetaUrlAssetUrl = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(expression, "NewExpression")) return false;
  if (
    !isNodeOfType(expression.callee, "Identifier") ||
    expression.callee.name !== "URL" ||
    !context.scopes.isGlobalReference(expression.callee)
  ) {
    return false;
  }
  const pathArgument = expression.arguments?.[0];
  const baseArgument = expression.arguments?.[1];
  if (!pathArgument || !baseArgument) return false;
  const pathPrefix = resolveStaticUrlPrefix(pathArgument as EsTreeNode, 0, context);
  if (pathPrefix === null || (!pathPrefix.startsWith("./") && !pathPrefix.startsWith("../"))) {
    return false;
  }
  const base = stripGroupingParens(baseArgument as EsTreeNode);
  return (
    isNodeOfType(base, "MemberExpression") &&
    !base.computed &&
    isNodeOfType(base.object, "MetaProperty") &&
    isNodeOfType(base.property, "Identifier") &&
    base.property.name === "url"
  );
};

const isInertUrlProducer = (argument: EsTreeNode, depth: number, context: RuleContext): boolean => {
  if (depth > MAX_URL_BINDING_RESOLUTION_DEPTH) return false;
  const expression = stripGroupingParens(argument);
  if (isImportMetaUrlAssetUrl(expression, context)) return true;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      isInertUrlProducer(expression.consequent, depth + 1, context) &&
      isInertUrlProducer(expression.alternate, depth + 1, context)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      isInertUrlProducer(expression.left, depth + 1, context) &&
      isInertUrlProducer(expression.right, depth + 1, context)
    );
  }
  if (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === "href"
  ) {
    return isInertUrlProducer(expression.object as EsTreeNode, depth + 1, context);
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripGroupingParens(expression.callee as EsTreeNode);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier")
    ) {
      if (callee.property.name === "toDataURL") {
        return isProvenCanvasReference(callee.object as EsTreeNode, context);
      }
      return Boolean(
        callee.property.name === "createObjectURL" &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "URL" &&
        context.scopes.isGlobalReference(callee.object),
      );
    }
    return Boolean(
      isNodeOfType(callee, "Identifier") &&
      callee.name === "require" &&
      context.scopes.isGlobalReference(callee),
    );
  }
  if (isNodeOfType(expression, "Identifier")) {
    if (bindingIsAssignedFromRequire(expression, context)) return true;
    const symbol = context.scopes.symbolFor(expression);
    const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
    if (!initializer || initializer === expression) return false;
    return isInertUrlProducer(initializer, depth + 1, context);
  }
  return false;
};

const fetchesInertUrlScheme = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return false;
  const urlPrefix = resolveStaticUrlPrefix(firstArgument as EsTreeNode, 0, context);
  if (urlPrefix !== null && INERT_URL_SCHEME_PATTERN.test(urlPrefix)) return true;
  return isInertUrlProducer(firstArgument as EsTreeNode, 0, context);
};

const isBodyConsumeCall = (node: EsTreeNode, responseName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : null;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === responseName &&
    BODY_CONSUMER_METHODS.has(getStaticPropertyName(callee) ?? "")
  );
};

const makeExpressionGuaranteesStatusCheck = (
  referencesToCheck: EsTreeNode[],
  mustGuaranteeTruthyReference = false,
) => {
  const resultsByPolarity = new WeakMap<EsTreeNode, [boolean | undefined, boolean | undefined]>();
  const expressionGuaranteesStatusCheck = (
    expression: EsTreeNode,
    branchRunsWhenTruthy: boolean,
  ): boolean => {
    const inner = stripGroupingParens(expression);
    const resultIndex = branchRunsWhenTruthy ? 1 : 0;
    const cachedResults = resultsByPolarity.get(inner);
    const cachedResult = cachedResults?.[resultIndex];
    if (cachedResult !== undefined) return cachedResult;
    const references = referencesToCheck
      .map(stripGroupingParens)
      .filter((reference) => isAstDescendant(reference, inner));
    let result = false;
    if (references.some((reference) => reference === inner)) {
      result = mustGuaranteeTruthyReference ? branchRunsWhenTruthy : true;
    } else if (references.length === 0) {
      result = false;
    } else if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
      result = expressionGuaranteesStatusCheck(inner.argument, !branchRunsWhenTruthy);
    } else if (isNodeOfType(inner, "LogicalExpression") && inner.operator === "&&") {
      result = branchRunsWhenTruthy
        ? expressionGuaranteesStatusCheck(inner.left, true) ||
          expressionGuaranteesStatusCheck(inner.right, true)
        : expressionGuaranteesStatusCheck(inner.left, false) &&
          (expressionGuaranteesStatusCheck(inner.left, true) ||
            expressionGuaranteesStatusCheck(inner.right, false));
    } else if (isNodeOfType(inner, "LogicalExpression") && inner.operator === "||") {
      result = branchRunsWhenTruthy
        ? expressionGuaranteesStatusCheck(inner.left, true) &&
          (expressionGuaranteesStatusCheck(inner.left, false) ||
            expressionGuaranteesStatusCheck(inner.right, true))
        : expressionGuaranteesStatusCheck(inner.left, false) ||
          expressionGuaranteesStatusCheck(inner.right, false);
    } else if (isNodeOfType(inner, "ConditionalExpression")) {
      const testAlwaysChecksStatus =
        expressionGuaranteesStatusCheck(inner.test, true) &&
        expressionGuaranteesStatusCheck(inner.test, false);
      result =
        testAlwaysChecksStatus ||
        (expressionGuaranteesStatusCheck(inner.consequent, branchRunsWhenTruthy) &&
          expressionGuaranteesStatusCheck(inner.alternate, branchRunsWhenTruthy));
    } else if (mustGuaranteeTruthyReference) {
      result = false;
    } else if (
      isNodeOfType(inner, "CallExpression") &&
      inner.optional === true &&
      inner.arguments.some(
        (argument) =>
          !isNodeOfType(argument, "SpreadElement") &&
          references.some((reference) => isAstDescendant(reference, argument)),
      )
    ) {
      result = branchRunsWhenTruthy;
    } else {
      result = references.some((reference) => {
        let child = reference;
        let ancestor = reference.parent ?? null;
        while (ancestor) {
          if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) return false;
          if (isNodeOfType(ancestor, "ConditionalExpression") && ancestor.test !== child) {
            return false;
          }
          if (
            isNodeOfType(ancestor, "CallExpression") &&
            ancestor.optional === true &&
            ancestor.callee !== child
          ) {
            return findTransparentExpressionRoot(ancestor) === inner && branchRunsWhenTruthy;
          }
          if (ancestor === inner) return true;
          child = ancestor;
          ancestor = ancestor.parent ?? null;
        }
        return false;
      });
    }
    const results = cachedResults ?? [undefined, undefined];
    results[resultIndex] = result;
    resultsByPolarity.set(inner, results);
    return result;
  };
  return expressionGuaranteesStatusCheck;
};

const statusCheckGuardsNode = (statusReferences: EsTreeNode[], target: EsTreeNode): boolean => {
  const successfulStatusReferences = statusReferences.filter((reference) => {
    const inner = stripGroupingParens(reference);
    return isNodeOfType(inner, "MemberExpression") && getStaticPropertyName(inner) === "ok";
  });
  const expressionGuaranteesStatusCheck = makeExpressionGuaranteesStatusCheck(statusReferences);
  const expressionGuaranteesSuccessfulStatus = makeExpressionGuaranteesStatusCheck(
    successfulStatusReferences,
    true,
  );
  const conditionGuaranteesStatusCheck = (
    test: EsTreeNode,
    branchRunsWhenTruthy: boolean,
  ): boolean => expressionGuaranteesStatusCheck(test, branchRunsWhenTruthy);
  const continuingBranchHasValidStatus = (
    test: EsTreeNode,
    branchRunsWhenTruthy: boolean,
  ): boolean =>
    !successfulStatusReferences.some((reference) => isAstDescendant(reference, test)) ||
    expressionGuaranteesSuccessfulStatus(test, branchRunsWhenTruthy);
  let child = target;
  let ancestor = target.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) {
      if (
        (ancestor.operator === "&&" && conditionGuaranteesStatusCheck(ancestor.left, true)) ||
        (ancestor.operator === "||" && conditionGuaranteesStatusCheck(ancestor.left, false))
      ) {
        return true;
      }
    }
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      if (ancestor.consequent === child && conditionGuaranteesStatusCheck(ancestor.test, true)) {
        return true;
      }
      if (ancestor.alternate === child && conditionGuaranteesStatusCheck(ancestor.test, false)) {
        return true;
      }
    }
    if (
      isNodeOfType(ancestor, "SwitchCase") &&
      ancestor.parent &&
      isNodeOfType(ancestor.parent, "SwitchStatement")
    ) {
      const discriminantChecksStatus =
        conditionGuaranteesStatusCheck(ancestor.parent.discriminant, true) &&
        conditionGuaranteesStatusCheck(ancestor.parent.discriminant, false);
      const caseChecksStatus =
        ancestor.parent.cases[0] === ancestor &&
        ancestor.test !== null &&
        conditionGuaranteesStatusCheck(ancestor.test, true);
      if (discriminantChecksStatus || caseChecksStatus) return true;
    }
    if (
      (isNodeOfType(ancestor, "WhileStatement") || isNodeOfType(ancestor, "ForStatement")) &&
      ancestor.body === child &&
      ancestor.test &&
      conditionGuaranteesStatusCheck(ancestor.test, true)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      if (childIndex >= 0) {
        for (const statement of ancestor.body.slice(0, childIndex)) {
          if (!isNodeOfType(statement, "IfStatement")) continue;
          if (
            isEarlyExitStatement(statement.consequent) &&
            conditionGuaranteesStatusCheck(statement.test, false) &&
            continuingBranchHasValidStatus(statement.test, false)
          ) {
            return true;
          }
          if (
            isEarlyExitStatement(statement.alternate) &&
            conditionGuaranteesStatusCheck(statement.test, true) &&
            continuingBranchHasValidStatus(statement.test, true)
          ) {
            return true;
          }
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const outermostPromiseChainCall = (fetchCall: EsTreeNode): EsTreeNode => {
  let chainLink: EsTreeNode = fetchCall;
  while (true) {
    const member = getTransparentExpressionParent(chainLink);
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripParenExpression(member.object as EsTreeNode) !== chainLink ||
      !PROMISE_CHAIN_METHODS.has(getStaticPropertyName(member) ?? "")
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
      member && isNodeOfType(member, "MemberExpression") ? getStaticPropertyName(member) : null;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripGroupingParens(member.object as EsTreeNode) !== chainLink ||
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
  const responseSymbols = collectConstAliasSymbols(symbol, context.scopes);
  const responseReferences = responseSymbols.flatMap((responseSymbol) => responseSymbol.references);
  const isConditionUse = (candidate: EsTreeNode): boolean => {
    let current = findTransparentExpressionRoot(candidate);
    while (current.parent) {
      const parent = current.parent;
      if (
        (isNodeOfType(parent, "ConditionalExpression") && parent.test === current) ||
        (isNodeOfType(parent, "LogicalExpression") && parent.left === current)
      ) {
        return true;
      }
      if (
        (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
        isNodeOfType(parent, "BinaryExpression") ||
        isNodeOfType(parent, "LogicalExpression") ||
        isNodeOfType(parent, "ConditionalExpression")
      ) {
        current = parent;
        continue;
      }
      return Boolean(
        (isNodeOfType(parent, "IfStatement") && parent.test === current) ||
        ((isNodeOfType(parent, "WhileStatement") ||
          isNodeOfType(parent, "DoWhileStatement") ||
          isNodeOfType(parent, "ForStatement")) &&
          parent.test === current) ||
        (isNodeOfType(parent, "SwitchStatement") && parent.discriminant === current) ||
        (isNodeOfType(parent, "SwitchCase") && parent.test === current),
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
      !BODY_CONSUMER_METHODS.has(getStaticPropertyName(member) ?? "")
    ) {
      return null;
    }
    const call = getMeaningfulParent(member);
    return call && isNodeOfType(call, "CallExpression") && call.callee === member ? call : null;
  };
  const consumptions = responseReferences
    .map((reference) => consumeCallForReference(reference.identifier))
    .filter((candidate): candidate is EsTreeNode => candidate !== null);
  if (!responseBindingCanBeUndefined) {
    for (const reference of responseReferences) {
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
  if (consumptions.length === 0) return;

  const directStatusReferences = responseReferences.flatMap((reference) => {
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      !STATUS_CHECK_PROPERTIES.has(getStaticPropertyName(member) ?? "") ||
      !isConditionUse(member)
    ) {
      return [];
    }
    return [member];
  });

  const destructuredStatusReferences = responseReferences.flatMap((reference) => {
    const declarator = reference.identifier.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== reference.identifier ||
      !isNodeOfType(declarator.id, "ObjectPattern")
    ) {
      return [];
    }
    return declarator.id.properties.flatMap((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        !isNodeOfType(property.key, "Identifier") ||
        !STATUS_CHECK_PROPERTIES.has(property.key.name) ||
        !isNodeOfType(property.value, "Identifier")
      ) {
        return [];
      }
      const statusSymbol = context.scopes.symbolFor(property.value);
      if (
        !statusSymbol ||
        statusSymbol.references.some((statusReference) => statusReference.flag !== "read")
      ) {
        return [];
      }
      return statusSymbol.references
        .map((statusReference) => statusReference.identifier)
        .filter(isConditionUse);
    });
  });

  const everyConsumptionIsGuarded = consumptions.every((consumption) => {
    if (
      directStatusReferences.length > 0 &&
      statusCheckGuardsNode(directStatusReferences, consumption)
    ) {
      return true;
    }
    if (
      destructuredStatusReferences.length > 0 &&
      statusCheckGuardsNode(destructuredStatusReferences, consumption)
    ) {
      return true;
    }
    return responseReferences.some((reference) => {
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
        nodeDominatesNode(parent, consumption, context),
      );
    });
  });
  if (everyConsumptionIsGuarded) return;
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
        if (!isGlobalFetchCall(node, context)) return;
        if (fetchesInertUrlScheme(node, context)) return;
        const fetchExpression = findTransparentExpressionRoot(node as EsTreeNode);
        const parent = getMeaningfulParent(fetchExpression);
        if (!parent) return;

        // Shape: fetch(...).then((response) => ...consume...)
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === fetchExpression &&
          getStaticPropertyName(parent) === "then"
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
          BODY_CONSUMER_METHODS.has(getStaticPropertyName(parent) ?? "")
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
            BODY_CONSUMER_METHODS.has(getStaticPropertyName(afterAwait) ?? "")
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
