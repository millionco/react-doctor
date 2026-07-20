import { FUNCTION_LIKE_TYPES } from "../../constants/js.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { walkAst } from "../../utils/walk-ast.js";

const OBJECT_ENUMERATION_METHOD_NAMES = new Set(["keys", "entries", "values"]);
const NON_GROWING_ARRAY_METHOD_NAMES = new Set([
  "copyWithin",
  "fill",
  "filter",
  "map",
  "reverse",
  "slice",
  "sort",
  "toReversed",
  "toSorted",
  "with",
]);
const NON_GROWING_ARRAY_RECEIVER_METHOD_NAMES = new Set([
  ...NON_GROWING_ARRAY_METHOD_NAMES,
  "at",
  "concat",
  "entries",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "pop",
  "reduce",
  "reduceRight",
  "shift",
  "some",
  "toLocaleString",
  "toSpliced",
  "toString",
  "values",
]);
const OBJECT_GROWING_MUTATION_METHOD_NAMES = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
]);

const isFreshLiteralSeed = (seedArgument: EsTreeNode | undefined): boolean => {
  if (!isAstNode(seedArgument)) return false;
  const stripped = stripParenExpression(seedArgument);
  return isNodeOfType(stripped, "ObjectExpression") || isNodeOfType(stripped, "ArrayExpression");
};

const isSpreadFreeArrayLiteral = (node: EsTreeNode, mustHaveElements: boolean): boolean => {
  if (!isNodeOfType(node, "ArrayExpression")) return false;
  if (mustHaveElements && node.elements.length === 0) return false;
  return node.elements.every((element) => !isNodeOfType(element, "SpreadElement"));
};

const isSpreadFreeObjectLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ObjectExpression") &&
  node.properties.every((property) => !isNodeOfType(property, "SpreadElement"));

const isFixedShapeObjectLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ObjectExpression") &&
  node.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== null,
  );

const isRestParameterBinding = (bindingIdentifier: EsTreeNode): boolean => {
  const restCandidate = bindingIdentifier.parent;
  return Boolean(
    restCandidate &&
    isNodeOfType(restCandidate, "RestElement") &&
    restCandidate.parent &&
    FUNCTION_LIKE_TYPES.has(restCandidate.parent.type),
  );
};

const findRetainingAliasBinding = (expression: EsTreeNode): EsTreeNode | null => {
  let current = findTransparentExpressionRoot(expression);
  while (current.parent) {
    const parent = current.parent;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === current || parent.right === current))
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === current &&
      isNodeOfType(parent.id, "Identifier") &&
      parent.parent &&
      isNodeOfType(parent.parent, "VariableDeclaration")
    ) {
      return parent.id;
    }
    return null;
  }
  return null;
};

const bindingMayHaveGrown = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  growthBySymbolId: Map<number, boolean>,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol) return true;
  const cachedResult = growthBySymbolId.get(symbol.id);
  if (cachedResult !== undefined) return cachedResult;
  if (visitedSymbolIds.has(symbol.id)) return false;
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  const didBindingGrow = symbol.references.some((reference) => {
    if (reference.flag !== "read") return true;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const aliasBinding = findRetainingAliasBinding(referenceRoot);
    if (aliasBinding && scopes.symbolFor(aliasBinding) !== symbol) {
      return bindingMayHaveGrown(aliasBinding, scopes, growthBySymbolId, nextVisitedSymbolIds);
    }
    const directConsumer = referenceRoot.parent;
    if (
      directConsumer &&
      isNodeOfType(directConsumer, "CallExpression") &&
      directConsumer.arguments.some(
        (argument) =>
          isAstNode(argument) &&
          stripParenExpression(argument) === stripParenExpression(referenceRoot),
      )
    ) {
      const directCallee = stripParenExpression(directConsumer.callee);
      if (
        isNodeOfType(directCallee, "MemberExpression") &&
        isProvenUnmodifiedGlobalNamespaceReference(directCallee.object, "Object", scopes) &&
        OBJECT_GROWING_MUTATION_METHOD_NAMES.has(getStaticPropertyName(directCallee) ?? "")
      ) {
        return true;
      }
      if (
        isNodeOfType(directCallee, "MemberExpression") &&
        ((isProvenUnmodifiedGlobalNamespaceReference(directCallee.object, "Array", scopes) &&
          getStaticPropertyName(directCallee) === "from") ||
          (isProvenUnmodifiedGlobalNamespaceReference(directCallee.object, "Object", scopes) &&
            OBJECT_ENUMERATION_METHOD_NAMES.has(getStaticPropertyName(directCallee) ?? "")))
      ) {
        return false;
      }
      if (isNodeOfType(directCallee, "MemberExpression")) {
        const localFunction = resolveStaticLocalCallFunction(directConsumer, scopes);
        if (
          localFunction &&
          isFunctionLike(localFunction) &&
          isNodeOfType(localFunction.body, "BlockStatement") &&
          localFunction.body.body.length === 0
        ) {
          return false;
        }
      }
      return true;
    }
    if (
      (isNodeOfType(directConsumer, "Property") && directConsumer.value === referenceRoot) ||
      isNodeOfType(directConsumer, "ArrayExpression") ||
      isNodeOfType(directConsumer, "SpreadElement")
    ) {
      return true;
    }
    const member = referenceRoot.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      stripParenExpression(member.object) !== stripParenExpression(referenceRoot)
    ) {
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    const consumer = memberRoot.parent;
    if (
      (isNodeOfType(consumer, "AssignmentExpression") && consumer.left === memberRoot) ||
      (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === memberRoot) ||
      (isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "delete" &&
        consumer.argument === memberRoot)
    ) {
      return true;
    }
    if (!isNodeOfType(consumer, "CallExpression") || consumer.callee !== memberRoot) return false;
    const methodName = getStaticPropertyName(member);
    return !methodName || !NON_GROWING_ARRAY_RECEIVER_METHOD_NAMES.has(methodName);
  });
  growthBySymbolId.set(symbol.id, didBindingGrow);
  return didBindingGrow;
};

const isFixedLengthArrayConstruction = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(expression, "CallExpression") && !isNodeOfType(expression, "NewExpression")) {
    return false;
  }
  const callee = stripParenExpression(expression.callee);
  const lengthArgument = expression.arguments[0];
  return Boolean(
    isProvenUnmodifiedGlobalNamespaceReference(callee, "Array", scopes) &&
    expression.arguments.length === 1 &&
    isAstNode(lengthArgument) &&
    isNodeOfType(lengthArgument, "Literal") &&
    typeof lengthArgument.value === "number",
  );
};

const isFixedLengthArrayLikeObject = (expression: EsTreeNode): boolean => {
  if (!isNodeOfType(expression, "ObjectExpression")) return false;
  const lengthProperties = expression.properties.filter(
    (property) =>
      isNodeOfType(property, "Property") &&
      property.kind === "init" &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "length",
  );
  if (
    lengthProperties.length !== 1 ||
    expression.properties.some((property) => isNodeOfType(property, "SpreadElement"))
  ) {
    return false;
  }
  const lengthProperty = lengthProperties[0];
  if (!isNodeOfType(lengthProperty, "Property")) return false;
  const lengthValue = stripParenExpression(lengthProperty.value);
  return isNodeOfType(lengthValue, "Literal") && typeof lengthValue.value === "number";
};

const isStaticallyBoundedCollectionExpression = (
  expression: EsTreeNode,
  collectionKind: "array" | "object",
  scopes: ScopeAnalysis,
  growthBySymbolId: Map<number, boolean>,
): boolean => {
  const pendingExpressions = [stripParenExpression(expression)];
  const pendingVisitedSymbolIds = [new Set<number>()];
  while (pendingExpressions.length > 0) {
    const currentExpression = pendingExpressions.pop();
    const visitedSymbolIds = pendingVisitedSymbolIds.pop();
    if (!currentExpression || !visitedSymbolIds) return false;
    if (
      (collectionKind === "array" && isFixedLengthArrayConstruction(currentExpression, scopes)) ||
      (collectionKind === "array" && isFixedLengthArrayLikeObject(currentExpression)) ||
      (collectionKind === "array" && isSpreadFreeArrayLiteral(currentExpression, false)) ||
      (collectionKind === "object" && isSpreadFreeObjectLiteral(currentExpression))
    ) {
      continue;
    }
    if (isNodeOfType(currentExpression, "Identifier")) {
      const symbol = scopes.symbolFor(currentExpression);
      const binding = findVariableInitializer(currentExpression, currentExpression.name);
      if (
        !symbol ||
        !binding ||
        visitedSymbolIds.has(symbol.id) ||
        bindingMayHaveGrown(currentExpression, scopes, growthBySymbolId)
      ) {
        return false;
      }
      if (isRestParameterBinding(binding.bindingIdentifier)) continue;
      const declarator = binding.bindingIdentifier.parent;
      if (
        !symbol.initializer ||
        symbol.kind !== "const" ||
        !binding.initializer ||
        symbol.initializer !== binding.initializer ||
        !declarator ||
        !isNodeOfType(declarator, "VariableDeclarator") ||
        declarator.init !== binding.initializer
      ) {
        return false;
      }
      const nextVisitedSymbolIds = new Set(visitedSymbolIds);
      nextVisitedSymbolIds.add(symbol.id);
      pendingExpressions.push(stripParenExpression(symbol.initializer));
      pendingVisitedSymbolIds.push(nextVisitedSymbolIds);
      continue;
    }
    if (isNodeOfType(currentExpression, "ConditionalExpression")) {
      pendingExpressions.push(
        stripParenExpression(currentExpression.consequent),
        stripParenExpression(currentExpression.alternate),
      );
      pendingVisitedSymbolIds.push(new Set(visitedSymbolIds), new Set(visitedSymbolIds));
      continue;
    }
    if (collectionKind === "object") return false;
    if (!isNodeOfType(currentExpression, "CallExpression")) return false;
    const callee = stripParenExpression(currentExpression.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const methodName = getStaticPropertyName(callee);
    if (
      isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Array", scopes) &&
      methodName === "from"
    ) {
      const sourceArgument = currentExpression.arguments[0];
      if (!isAstNode(sourceArgument)) return false;
      pendingExpressions.push(stripParenExpression(sourceArgument));
      pendingVisitedSymbolIds.push(visitedSymbolIds);
      continue;
    }
    if (!methodName || !NON_GROWING_ARRAY_METHOD_NAMES.has(methodName)) return false;
    pendingExpressions.push(stripParenExpression(callee.object));
    pendingVisitedSymbolIds.push(visitedSymbolIds);
  }
  return true;
};

// The empirical false-positive pattern is spreading the accumulator over a
// statically bounded collection — a rest parameter (bounded by call-site
// arity), an array literal, or the keys/entries of a locally constructed
// object literal — where n is tiny and fixed, so the O(n²) copy cost is
// unobservable and the immutable idiom is deliberate.
const isStaticallyBoundedReduceSource = (
  source: EsTreeNode,
  scopes: ScopeAnalysis,
  growthBySymbolId: Map<number, boolean>,
): boolean => {
  const stripped = stripParenExpression(source);
  if (isSpreadFreeArrayLiteral(stripped, false)) return true;
  if (isStaticallyBoundedCollectionExpression(stripped, "array", scopes, growthBySymbolId)) {
    return true;
  }
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const enumerationCallee = stripParenExpression(stripped.callee);
  if (!isNodeOfType(enumerationCallee, "MemberExpression")) return false;
  if (!isProvenUnmodifiedGlobalNamespaceReference(enumerationCallee.object, "Object", scopes)) {
    return false;
  }
  const enumerationMethodName = getStaticPropertyName(enumerationCallee);
  if (!enumerationMethodName || !OBJECT_ENUMERATION_METHOD_NAMES.has(enumerationMethodName)) {
    return false;
  }
  const enumeratedObject = stripped.arguments[0];
  return (
    isAstNode(enumeratedObject) &&
    isStaticallyBoundedCollectionExpression(enumeratedObject, "object", scopes, growthBySymbolId)
  );
};

const hasOwnReducerMethod = (
  source: EsTreeNode,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  let candidate = stripParenExpression(source);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(candidate, scopes);
    if (!symbol?.initializer) return false;
    candidate = stripParenExpression(symbol.initializer);
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return false;
  return candidate.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === methodName,
  );
};

interface ReducerReturnAnalysis {
  returnedLiterals: EsTreeNode[];
  // A `return acc` path unchanged alongside the spread is the filter /
  // dedup shape — growth is bounded by matches, empirically benign.
  hasAccumulatorPassthroughReturn: boolean;
}

// Collects the object/array literals a reducer callback returns — the
// concise-body expression, or every top-level `return X`. Stops at
// nested function boundaries so an inner callback's return isn't
// mistaken for the reducer's own.
const analyzeReducerReturns = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
  accumulatorParameter: EsTreeNode,
  context: RuleContext,
): ReducerReturnAnalysis => {
  const { scopes } = context;
  const analysis: ReducerReturnAnalysis = {
    returnedLiterals: [],
    hasAccumulatorPassthroughReturn: false,
  };
  const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
  const returnIsReachable = (returnStatement: EsTreeNode): boolean => {
    if (!isNodeReachableWithinFunction(returnStatement, context)) return false;
    let current = returnStatement;
    while (current !== callback.body && current.parent) {
      const parent = current.parent;
      if (isNodeOfType(parent, "BlockStatement")) {
        const currentIndex = parent.body.findIndex((statement) => statement === current);
        if (
          currentIndex > 0 &&
          parent.body.slice(0, currentIndex).some((statement) => statementAlwaysExits(statement))
        ) {
          return false;
        }
      }
      current = parent;
    }
    return true;
  };
  const recordReturnedExpression = (expression: EsTreeNode | null | undefined): void => {
    if (!expression) return;
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "ConditionalExpression")) {
      recordReturnedExpression(stripped.consequent);
      recordReturnedExpression(stripped.alternate);
      return;
    }
    if (isNodeOfType(stripped, "SequenceExpression")) {
      recordReturnedExpression(stripped.expressions.at(-1));
      return;
    }
    if (isNodeOfType(stripped, "LogicalExpression")) {
      const left = stripParenExpression(stripped.left);
      const leftIsAccumulator =
        isNodeOfType(left, "Identifier") &&
        accumulatorSymbol !== null &&
        scopes.symbolFor(left) === accumulatorSymbol;
      const leftIsAlwaysTruthy =
        isNodeOfType(left, "ObjectExpression") || isNodeOfType(left, "ArrayExpression");
      if (leftIsAccumulator || leftIsAlwaysTruthy) {
        recordReturnedExpression(stripped.operator === "&&" ? stripped.right : stripped.left);
        return;
      }
      recordReturnedExpression(stripped.left);
      recordReturnedExpression(stripped.right);
      return;
    }
    if (isNodeOfType(stripped, "ObjectExpression") || isNodeOfType(stripped, "ArrayExpression")) {
      analysis.returnedLiterals.push(stripped);
      return;
    }
    if (
      isNodeOfType(stripped, "Identifier") &&
      accumulatorSymbol !== null &&
      scopes.symbolFor(stripped) === accumulatorSymbol
    ) {
      analysis.hasAccumulatorPassthroughReturn = true;
    }
  };

  const body = callback.body;
  if (!body) return analysis;
  if (!isNodeOfType(body, "BlockStatement")) {
    recordReturnedExpression(body);
    return analysis;
  }

  walkAst(body, (child) => {
    if (FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (isNodeOfType(child, "ReturnStatement") && returnIsReachable(child)) {
      recordReturnedExpression(child.argument);
      return false;
    }
  });
  return analysis;
};

// Any spread of the accumulator copies the whole growing collection,
// no matter where it sits in the literal — `{ ...mapItem(x), ...acc }`
// and `[...g.items, ...acc]` are as quadratic as the leading-spread form.
const literalSpreadsAccumulator = (
  literal: EsTreeNode,
  accumulatorParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
  if (!accumulatorSymbol) return false;
  const members = isNodeOfType(literal, "ObjectExpression")
    ? literal.properties
    : isNodeOfType(literal, "ArrayExpression")
      ? literal.elements
      : null;
  if (!members) return false;
  return members.some((member) => {
    if (!isNodeOfType(member, "SpreadElement")) return false;
    const spreadArgument = stripParenExpression(member.argument);
    return (
      isNodeOfType(spreadArgument, "Identifier") &&
      scopes.symbolFor(spreadArgument) === accumulatorSymbol
    );
  });
};

const literalGrowsAccumulatorPerIteration = (
  literal: EsTreeNode,
  accumulatorParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(literal, "ArrayExpression")) {
    const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
    const accumulatorSpreadCount = literal.elements.filter((element) => {
      if (!isNodeOfType(element, "SpreadElement")) return false;
      const spreadArgument = stripParenExpression(element.argument);
      return (
        isNodeOfType(spreadArgument, "Identifier") &&
        scopes.symbolFor(spreadArgument) === accumulatorSymbol
      );
    }).length;
    return literal.elements.some((element) => {
      if (!element) return false;
      if (!isNodeOfType(element, "SpreadElement")) return true;
      const spreadArgument = stripParenExpression(element.argument);
      if (isNodeOfType(spreadArgument, "ArrayExpression") && spreadArgument.elements.length === 0) {
        return false;
      }
      return (
        !isNodeOfType(spreadArgument, "Identifier") ||
        scopes.symbolFor(spreadArgument) !== accumulatorSymbol ||
        accumulatorSpreadCount > 1
      );
    });
  }
  if (!isNodeOfType(literal, "ObjectExpression")) return false;
  const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
  return literal.properties.some((property) => {
    if (isNodeOfType(property, "Property")) {
      return property.computed && getStaticPropertyKeyName(property) === null;
    }
    if (!isNodeOfType(property, "SpreadElement")) return false;
    const spreadArgument = stripParenExpression(property.argument);
    if (
      isNodeOfType(spreadArgument, "Identifier") &&
      scopes.symbolFor(spreadArgument) === accumulatorSymbol
    ) {
      return false;
    }
    return !isFixedShapeObjectLiteral(spreadArgument);
  });
};

export const noSpreadAccumulatorInReduce = defineRule({
  id: "no-spread-accumulator-in-reduce",
  title: "Accumulator spread in reduce is quadratic",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Mutate the accumulator and return it (`acc[key] = value; return acc`) so the fold stays O(n) instead of copying the whole accumulator every step.",
  create: (context: RuleContext) => {
    const growthBySymbolId = new Map<number, boolean>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const reducerMethodName = getStaticPropertyName(callee);
        if (reducerMethodName !== "reduce" && reducerMethodName !== "reduceRight") return;
        if (hasOwnReducerMethod(callee.object, reducerMethodName, context.scopes)) return;
        if (!isFreshLiteralSeed(node.arguments[1])) return;
        if (isStaticallyBoundedReduceSource(callee.object, context.scopes, growthBySymbolId))
          return;

        const callbackArgument = node.arguments[0];
        if (!callbackArgument || !isAstNode(callbackArgument)) return;
        const callback = stripParenExpression(callbackArgument);
        if (
          !callback ||
          (!isNodeOfType(callback, "ArrowFunctionExpression") &&
            !isNodeOfType(callback, "FunctionExpression"))
        ) {
          return;
        }
        if (callback.async || callback.generator) return;
        const accumulatorParam = callback.params[0];
        if (!accumulatorParam || !isNodeOfType(accumulatorParam, "Identifier")) return;

        const analysis = analyzeReducerReturns(callback, accumulatorParam, context);
        for (const literal of analysis.returnedLiterals) {
          if (
            literalSpreadsAccumulator(literal, accumulatorParam, context.scopes) &&
            literalGrowsAccumulatorPerIteration(literal, accumulatorParam, context.scopes)
          ) {
            context.report({
              node: literal,
              message:
                "This is O(n²) because spreading the accumulator copies the entire growing collection every step. Mutate and return the accumulator instead (acc[key] = value; return acc).",
            });
            return;
          }
        }
      },
    };
  },
});
