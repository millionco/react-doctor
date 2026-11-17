import { ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX } from "../constants/js.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectPatternDefaultReferenceNames } from "./collect-pattern-default-reference-names.js";
import { collectPatternNames } from "./collect-pattern-names.js";
import { expressionReadsPatternBinding } from "./expression-reads-pattern-binding.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPrefixOnlyIterationFilter } from "./is-prefix-only-iteration-filter.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { stripThisParameter } from "./strip-this-parameter.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

interface IterationArgumentPacket {
  pattern: EsTreeNode;
  arrayIndex: number;
}

const patternObservesIterationArray = (
  pattern: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (expressionReadsPatternBinding(callback, [pattern], scopes)) return true;
  const binding = isNodeOfType(pattern, "AssignmentPattern") ? pattern.left : pattern;
  if (!isNodeOfType(binding, "ArrayPattern") && !isNodeOfType(binding, "ObjectPattern"))
    return false;
  let observesArray = false;
  walkAst(binding, (node) => {
    if (observesArray) return false;
    if (
      node !== binding &&
      (isNodeOfType(node, "AssignmentPattern") ||
        isNodeOfType(node, "ArrayPattern") ||
        isNodeOfType(node, "ObjectPattern") ||
        (isNodeOfType(node, "Property") &&
          node.computed &&
          getStaticPropertyKeyName(node, {
            allowComputedString: true,
            stringifyNonStringLiterals: true,
          }) === null))
    )
      observesArray = true;
  });
  return observesArray;
};

const isScalarPacketReference = (identifier: EsTreeNode, arrayIndex: number): boolean => {
  const reference = findTransparentExpressionRoot(identifier);
  const member = reference.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== reference ||
    isWithinAssignmentTarget(member)
  )
    return false;
  const property = getStaticPropertyKeyName(member, {
    allowComputedString: true,
    stringifyNonStringLiterals: true,
  });
  if (property === "length") return true;
  const index = Number(property);
  return (
    property !== null &&
    String(index) === property &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < arrayIndex
  );
};

const getDestructuredPacketPattern = (identifier: EsTreeNode): EsTreeNode | null => {
  const reference = findTransparentExpressionRoot(identifier);
  const declaration = reference.parent;
  return isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === reference &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.kind === "const" &&
    (isNodeOfType(declaration.id, "ArrayPattern") || isNodeOfType(declaration.id, "ObjectPattern"))
    ? declaration.id
    : null;
};

const packetPatternNeedsArray = (
  initial: IterationArgumentPacket,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const pending = [initial];
  const visitedPatterns = new Set<EsTreeNode>();
  while (pending.length > 0) {
    const packet = pending.pop();
    if (!packet) continue;
    const { pattern, arrayIndex } = packet;
    if (visitedPatterns.has(pattern)) return true;
    visitedPatterns.add(pattern);
    if (isNodeOfType(pattern, "AssignmentPattern")) {
      pending.push({ pattern: pattern.left, arrayIndex });
    } else if (isNodeOfType(pattern, "Identifier")) {
      const symbol = scopes.symbolFor(pattern);
      if (!symbol) return true;
      for (const reference of symbol.references) {
        if (reference.flag === "read" && isScalarPacketReference(reference.identifier, arrayIndex))
          continue;
        const destructured = getDestructuredPacketPattern(reference.identifier);
        if (!destructured) return true;
        pending.push({ pattern: destructured, arrayIndex });
      }
    } else if (isNodeOfType(pattern, "ArrayPattern")) {
      for (let index = 0; index <= arrayIndex && index < pattern.elements.length; index++) {
        const element = pattern.elements[index];
        if (isNodeOfType(element, "RestElement")) {
          pending.push({ pattern: element.argument, arrayIndex: arrayIndex - index });
          break;
        }
        if (
          index === arrayIndex &&
          element &&
          patternObservesIterationArray(element, callback, scopes)
        )
          return true;
      }
    } else if (isNodeOfType(pattern, "ObjectPattern")) {
      const targetKey = String(arrayIndex);
      const hasTargetProperty = pattern.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          getStaticPropertyKeyName(property, {
            allowComputedString: true,
            stringifyNonStringLiterals: true,
          }) === targetKey,
      );
      for (const property of pattern.properties) {
        if (isNodeOfType(property, "RestElement")) {
          if (
            !hasTargetProperty &&
            expressionReadsPatternBinding(callback, [property.argument], scopes)
          )
            return true;
        } else if (isNodeOfType(property, "Property")) {
          const key = getStaticPropertyKeyName(property, {
            allowComputedString: true,
            stringifyNonStringLiterals: true,
          });
          if (
            (key === targetKey || key === null) &&
            patternObservesIterationArray(property.value, callback, scopes)
          )
            return true;
        }
      }
    } else if (expressionReadsPatternBinding(callback, [pattern], scopes)) {
      return true;
    }
  }
  return false;
};

const hasUncertainCallbackScope = (
  callback: EsTreeNode,
  arrayBindingNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  let uncertain = false;
  walkAst(callback, (node) => {
    if (uncertain) return false;
    const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      (isNodeOfType(callee, "Identifier") && callee.name === "eval")
    ) {
      uncertain = true;
      return false;
    }
    if (isFunctionLike(node)) {
      const parameterReferences = new Set<string>();
      for (const parameter of node.params)
        collectPatternDefaultReferenceNames(parameter, parameterReferences);
      uncertain = Boolean(
        scopes
          .ownScopeFor(node)
          ?.symbols.some(
            (symbol) =>
              symbol.kind !== "parameter" &&
              ((node === callback && arrayBindingNames.has(symbol.name)) ||
                ((arrayBindingNames.has(symbol.name) || symbol.name === "arguments") &&
                  parameterReferences.has(symbol.name))),
          ),
      );
    }
    if (isNodeOfType(node, "Identifier") && arrayBindingNames.has(node.name)) {
      const symbol = scopes.referenceFor(node)?.resolvedSymbol;
      if (symbol?.kind === "ts-type-alias" || symbol?.kind === "ts-interface") uncertain = true;
    }
  });
  return uncertain;
};

const readsOwnArgumentsArray = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(callback, "FunctionExpression")) return false;
  let needsArray = false;
  walkAst(callback, (node) => {
    if (needsArray) return false;
    if (node !== callback && isFunctionLike(node) && node.type !== "ArrowFunctionExpression")
      return false;
    if (!isNodeOfType(node, "Identifier") || node.name !== "arguments") return;
    const reference = scopes.referenceFor(node);
    if (!reference) return;
    const symbol = reference.resolvedSymbol;
    if (
      symbol &&
      symbol.kind !== "ts-type-alias" &&
      symbol.kind !== "ts-interface" &&
      isAstDescendant(symbol.scope.node, callback) &&
      !(symbol.kind === "var" && symbol.scope.node === callback) &&
      symbol.declarationNode !== callback
    )
      return;
    if (
      reference.flag === "read" &&
      isScalarPacketReference(node, ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX)
    )
      return;
    const pattern = getDestructuredPacketPattern(node);
    needsArray =
      !pattern ||
      packetPatternNeedsArray(
        { pattern, arrayIndex: ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX },
        callback,
        scopes,
      );
  });
  return needsArray;
};

export const callbackNeedsCompletedIterationArray = (
  argument: EsTreeNode | null | undefined,
  outerMethod: string,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  if (!argument) return false;
  const callback = stripParenExpression(argument);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  )
    return false;
  if (outerMethod === "filter" && isPrefixOnlyIterationFilter(callback, context)) return false;
  const parameters = stripThisParameter(callback.params);
  const arrayBindingNames = new Set<string>();
  for (let index = 0; index <= ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX; index++) {
    const parameter = parameters[index];
    if (!parameter) continue;
    if (index === ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX || parameter.type === "RestElement")
      collectPatternNames(parameter, arrayBindingNames);
  }
  if (hasUncertainCallbackScope(callback, arrayBindingNames, scopes)) return true;
  for (let index = 0; index <= ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX; index++) {
    const parameter = parameters[index];
    if (isNodeOfType(parameter, "RestElement")) {
      if (
        packetPatternNeedsArray(
          {
            pattern: parameter.argument,
            arrayIndex: ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX - index,
          },
          callback,
          scopes,
        )
      )
        return true;
      break;
    }
    if (
      index === ARRAY_ITERATION_CALLBACK_ARRAY_ARGUMENT_INDEX &&
      parameter &&
      patternObservesIterationArray(parameter, callback, scopes)
    )
      return true;
  }
  return readsOwnArgumentsArray(callback, scopes);
};
