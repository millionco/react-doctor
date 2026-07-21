import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { MIXED_ICON_LIBRARY_MIN_FAMILY_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getIconLibraryFamily } from "../../utils/get-icon-library-family.js";
import { getResolvedStaticPropertyName } from "../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

interface FamilyResolution {
  certainty: "absent" | "known" | "unknown";
  families: Set<string>;
}

interface MemberAccess {
  properties: (string | null)[];
  root: EsTreeNode;
}

interface RegistryAssignment {
  isUnconditionalProgramWrite: boolean;
  node: EsTreeNodeOfType<"AssignmentExpression">;
}

interface RegistryMutationCall {
  isUnconditionalProgramCall: boolean;
  node: EsTreeNodeOfType<"CallExpression">;
}

interface JsxMemberAccess {
  properties: string[];
  root: EsTreeNodeOfType<"JSXIdentifier">;
}

const NON_INTERCHANGEABLE_ICON_FAMILIES: ReadonlySet<string> = new Set(["react-icons/si"]);

const absentResolution = (): FamilyResolution => ({
  certainty: "absent",
  families: new Set(),
});

const knownResolution = (families: Iterable<string> = []): FamilyResolution => ({
  certainty: "known",
  families: new Set(families),
});

const unknownResolution = (): FamilyResolution => ({
  certainty: "unknown",
  families: new Set(),
});

const combineResolutions = (resolutions: FamilyResolution[]): FamilyResolution => {
  if (resolutions.some((resolution) => resolution.certainty === "unknown")) {
    return unknownResolution();
  }
  const presentResolutions = resolutions.filter((resolution) => resolution.certainty === "known");
  if (presentResolutions.length === 0) return absentResolution();
  return knownResolution(presentResolutions.flatMap((resolution) => [...resolution.families]));
};

const getMemberAccess = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
  context: RuleContext,
): MemberAccess => {
  const properties: (string | null)[] = [];
  let currentExpression: EsTreeNode = memberExpression;
  while (isNodeOfType(currentExpression, "MemberExpression")) {
    properties.unshift(
      getResolvedStaticPropertyName(currentExpression, context.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      }),
    );
    currentExpression = stripParenExpression(currentExpression.object);
  }
  return { properties, root: currentExpression };
};

const getJsxMemberAccess = (
  memberExpression: EsTreeNodeOfType<"JSXMemberExpression">,
): JsxMemberAccess | null => {
  const properties: string[] = [];
  let currentName: EsTreeNode = memberExpression;
  while (isNodeOfType(currentName, "JSXMemberExpression")) {
    properties.unshift(currentName.property.name);
    currentName = currentName.object;
  }
  return isNodeOfType(currentName, "JSXIdentifier") ? { properties, root: currentName } : null;
};

const isUnconditionalProgramWrite = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
): boolean =>
  isNodeOfType(assignment.parent, "ExpressionStatement") &&
  isNodeOfType(assignment.parent.parent, "Program");

const isUnconditionalProgramCall = (call: EsTreeNodeOfType<"CallExpression">): boolean =>
  isNodeOfType(call.parent, "ExpressionStatement") && isNodeOfType(call.parent.parent, "Program");

const getBindingPatternPath = (
  pattern: EsTreeNode,
  bindingIdentifier: EsTreeNode,
): string[] | null => {
  if (pattern === bindingIdentifier) return [];
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return getBindingPatternPath(pattern.left, bindingIdentifier);
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      if (!isNodeOfType(property, "Property")) continue;
      const nestedPath = getBindingPatternPath(property.value, bindingIdentifier);
      if (!nestedPath) continue;
      const propertyName = getStaticPropertyKeyName(property, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      return propertyName ? [propertyName, ...nestedPath] : null;
    }
    return null;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const [elementIndex, element] of pattern.elements.entries()) {
      if (!element) continue;
      const nestedPath = getBindingPatternPath(element, bindingIdentifier);
      if (nestedPath) return [String(elementIndex), ...nestedPath];
    }
  }
  return null;
};

export const noMixedIconLibraries = defineRule({
  id: "no-mixed-icon-libraries",
  title: "File mixes visual icon families",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation: "Use one icon family in each file so stroke, fill, and proportions agree.",
  create: (context: RuleContext) => {
    const iconFamiliesBySymbolId = new Map<number, string>();
    const renderedFamilies = new Set<string>();
    const renderedNames: EsTreeNode[] = [];
    const assignments: RegistryAssignment[] = [];
    const mutationCalls: RegistryMutationCall[] = [];
    let programNode: EsTreeNodeOfType<"Program"> | null = null;

    const getStaticTruthiness = (
      expression: EsTreeNode,
      visitedSymbolIds: Set<number>,
    ): boolean | null => {
      const unwrappedExpression = stripParenExpression(expression);
      if (isNodeOfType(unwrappedExpression, "Literal")) {
        return Boolean(unwrappedExpression.value);
      }
      if (isNodeOfType(unwrappedExpression, "TemplateLiteral")) {
        const value = getStaticTemplateLiteralValue(unwrappedExpression);
        return value === null ? null : Boolean(value);
      }
      if (
        isNodeOfType(unwrappedExpression, "UnaryExpression") &&
        unwrappedExpression.operator === "!"
      ) {
        const argumentTruthiness = getStaticTruthiness(
          unwrappedExpression.argument,
          visitedSymbolIds,
        );
        return argumentTruthiness === null ? null : !argumentTruthiness;
      }
      if (isNodeOfType(unwrappedExpression, "Identifier")) {
        const symbol = context.scopes.symbolFor(unwrappedExpression);
        if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
        if (iconFamiliesBySymbolId.has(symbol.id)) return true;
        if (symbol.kind !== "const" || !symbol.initializer) return null;
        return getStaticTruthiness(symbol.initializer, new Set(visitedSymbolIds).add(symbol.id));
      }
      return null;
    };

    const resolveExpressionValue = (
      expression: EsTreeNode,
      visitedResolutions: Set<string>,
    ): FamilyResolution => {
      const unwrappedExpression = stripParenExpression(expression);
      if (
        isNodeOfType(unwrappedExpression, "Identifier") ||
        isNodeOfType(unwrappedExpression, "JSXIdentifier")
      ) {
        const symbol = context.scopes.symbolFor(unwrappedExpression);
        if (!symbol) return knownResolution();
        const directFamily = iconFamiliesBySymbolId.get(symbol.id);
        if (directFamily) return knownResolution([directFamily]);
        const visitKey = `value:${symbol.id}`;
        if (visitedResolutions.has(visitKey)) return unknownResolution();
        const nextVisitedResolutions = new Set(visitedResolutions).add(visitKey);
        const declaration = symbol.declarationNode;
        const bindingPath = isNodeOfType(declaration, "VariableDeclarator")
          ? getBindingPatternPath(declaration.id, symbol.bindingIdentifier)
          : null;
        let resolution =
          declaration &&
          isNodeOfType(declaration, "VariableDeclarator") &&
          declaration.init &&
          bindingPath &&
          bindingPath.length > 0
            ? resolveExactProperty(declaration.init, bindingPath, nextVisitedResolutions)
            : symbol.initializer
              ? resolveExpressionValue(symbol.initializer, nextVisitedResolutions)
              : knownResolution();
        for (const assignment of assignments) {
          const assignmentTarget = stripParenExpression(assignment.node.left);
          if (!isNodeOfType(assignmentTarget, "Identifier")) continue;
          if (context.scopes.symbolFor(assignmentTarget) !== symbol) continue;
          resolution =
            assignment.isUnconditionalProgramWrite && assignment.node.operator === "="
              ? resolveExpressionValue(assignment.node.right, new Set(nextVisitedResolutions))
              : unknownResolution();
        }
        return resolution;
      }
      if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
        const memberAccess = getMemberAccess(unwrappedExpression, context);
        const dynamicPropertyIndex = memberAccess.properties.indexOf(null);
        if (dynamicPropertyIndex >= 0) {
          return dynamicPropertyIndex === memberAccess.properties.length - 1
            ? resolveDynamicRegistry(
                memberAccess.root,
                visitedResolutions,
                memberAccess.properties
                  .slice(0, dynamicPropertyIndex)
                  .filter((property) => property !== null),
              )
            : unknownResolution();
        }
        return resolveExactProperty(
          memberAccess.root,
          memberAccess.properties.filter((property) => property !== null),
          visitedResolutions,
        );
      }
      if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
        const testTruthiness = getStaticTruthiness(unwrappedExpression.test, new Set());
        if (testTruthiness !== null) {
          return resolveExpressionValue(
            testTruthiness ? unwrappedExpression.consequent : unwrappedExpression.alternate,
            visitedResolutions,
          );
        }
        return combineResolutions([
          resolveExpressionValue(unwrappedExpression.consequent, new Set(visitedResolutions)),
          resolveExpressionValue(unwrappedExpression.alternate, new Set(visitedResolutions)),
        ]);
      }
      if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
        const leftTruthiness = getStaticTruthiness(unwrappedExpression.left, new Set());
        if (leftTruthiness !== null && unwrappedExpression.operator !== "??") {
          const selectedExpression =
            unwrappedExpression.operator === "&&"
              ? leftTruthiness
                ? unwrappedExpression.right
                : unwrappedExpression.left
              : leftTruthiness
                ? unwrappedExpression.left
                : unwrappedExpression.right;
          return resolveExpressionValue(selectedExpression, visitedResolutions);
        }
        return combineResolutions([
          resolveExpressionValue(unwrappedExpression.left, new Set(visitedResolutions)),
          resolveExpressionValue(unwrappedExpression.right, new Set(visitedResolutions)),
        ]);
      }
      if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
        const finalExpression = unwrappedExpression.expressions.at(-1);
        return finalExpression
          ? resolveExpressionValue(finalExpression, visitedResolutions)
          : knownResolution();
      }
      if (isNodeOfType(unwrappedExpression, "AssignmentExpression")) {
        return resolveExpressionValue(unwrappedExpression.right, visitedResolutions);
      }
      return knownResolution();
    };

    const resolveExactProperty = (
      expression: EsTreeNode,
      propertyPath: string[],
      visitedResolutions: Set<string>,
    ): FamilyResolution => {
      if (propertyPath.length === 0) {
        return resolveExpressionValue(expression, visitedResolutions);
      }
      const unwrappedExpression = stripParenExpression(expression);
      if (
        isNodeOfType(unwrappedExpression, "Identifier") ||
        isNodeOfType(unwrappedExpression, "JSXIdentifier")
      ) {
        const symbol = context.scopes.symbolFor(unwrappedExpression);
        if (!symbol) return unknownResolution();
        const directFamily = iconFamiliesBySymbolId.get(symbol.id);
        if (directFamily) return knownResolution([directFamily]);
        const visitKey = `property:${symbol.id}:${propertyPath.join(".")}`;
        if (visitedResolutions.has(visitKey)) return unknownResolution();
        const nextVisitedResolutions = new Set(visitedResolutions).add(visitKey);
        const declaration = symbol.declarationNode;
        const bindingPath = isNodeOfType(declaration, "VariableDeclarator")
          ? getBindingPatternPath(declaration.id, symbol.bindingIdentifier)
          : null;
        let resolution =
          isNodeOfType(declaration, "VariableDeclarator") &&
          declaration.init &&
          bindingPath &&
          bindingPath.length > 0
            ? resolveExactProperty(
                declaration.init,
                [...bindingPath, ...propertyPath],
                nextVisitedResolutions,
              )
            : symbol.initializer
              ? resolveExactProperty(symbol.initializer, propertyPath, nextVisitedResolutions)
              : unknownResolution();
        const aliasSymbolIds = new Set(
          collectConstAliasSymbols(symbol, context.scopes).map((aliasSymbol) => aliasSymbol.id),
        );
        for (const assignment of assignments) {
          const assignmentTarget = stripParenExpression(assignment.node.left);
          if (isNodeOfType(assignmentTarget, "Identifier")) {
            if (context.scopes.symbolFor(assignmentTarget) !== symbol) continue;
            resolution =
              assignment.isUnconditionalProgramWrite && assignment.node.operator === "="
                ? resolveExactProperty(
                    assignment.node.right,
                    propertyPath,
                    new Set(nextVisitedResolutions),
                  )
                : unknownResolution();
            continue;
          }
          if (!isNodeOfType(assignmentTarget, "MemberExpression")) continue;
          const memberAccess = getMemberAccess(assignmentTarget, context);
          if (!isNodeOfType(memberAccess.root, "Identifier")) continue;
          const rootSymbol = context.scopes.symbolFor(memberAccess.root);
          if (!rootSymbol || !aliasSymbolIds.has(rootSymbol.id)) continue;
          let matchingPrefixLength = 0;
          while (
            matchingPrefixLength < memberAccess.properties.length &&
            matchingPrefixLength < propertyPath.length &&
            memberAccess.properties[matchingPrefixLength] === propertyPath[matchingPrefixLength]
          ) {
            matchingPrefixLength += 1;
          }
          const nextTargetProperty = memberAccess.properties[matchingPrefixLength];
          if (nextTargetProperty === null && matchingPrefixLength < propertyPath.length) {
            resolution = unknownResolution();
            continue;
          }
          if (matchingPrefixLength < memberAccess.properties.length) continue;
          if (memberAccess.properties.length > propertyPath.length) continue;
          if (!assignment.isUnconditionalProgramWrite || assignment.node.operator !== "=") {
            resolution = unknownResolution();
            continue;
          }
          resolution = resolveExactProperty(
            assignment.node.right,
            propertyPath.slice(memberAccess.properties.length),
            new Set(nextVisitedResolutions),
          );
        }
        for (const mutationCall of mutationCalls) {
          const callee = stripParenExpression(mutationCall.node.callee);
          if (
            !isNodeOfType(callee, "MemberExpression") ||
            getStaticPropertyName(callee) !== "assign" ||
            !isNodeOfType(callee.object, "Identifier") ||
            callee.object.name !== "Object" ||
            !context.scopes.isGlobalReference(callee.object)
          ) {
            continue;
          }
          const target = mutationCall.node.arguments[0];
          if (!target || isNodeOfType(target, "SpreadElement")) continue;
          const unwrappedTarget = stripParenExpression(target);
          if (!isNodeOfType(unwrappedTarget, "Identifier")) continue;
          const targetSymbol = context.scopes.symbolFor(unwrappedTarget);
          if (!targetSymbol || !aliasSymbolIds.has(targetSymbol.id)) continue;
          if (!mutationCall.isUnconditionalProgramCall) {
            resolution = unknownResolution();
            continue;
          }
          for (const source of mutationCall.node.arguments.slice(1)) {
            if (isNodeOfType(source, "SpreadElement")) {
              resolution = unknownResolution();
              continue;
            }
            const sourceResolution = resolveExactProperty(
              source,
              propertyPath,
              new Set(nextVisitedResolutions),
            );
            if (sourceResolution.certainty !== "absent") resolution = sourceResolution;
          }
        }
        return resolution;
      }
      if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
        const memberAccess = getMemberAccess(unwrappedExpression, context);
        if (memberAccess.properties.some((property) => property === null)) {
          return unknownResolution();
        }
        return resolveExactProperty(
          memberAccess.root,
          [...memberAccess.properties.filter((property) => property !== null), ...propertyPath],
          visitedResolutions,
        );
      }
      if (isNodeOfType(unwrappedExpression, "ObjectExpression")) {
        const [propertyName, ...remainingPropertyPath] = propertyPath;
        if (!propertyName) return knownResolution();
        for (const property of unwrappedExpression.properties.toReversed()) {
          if (isNodeOfType(property, "SpreadElement")) {
            const spreadResolution = resolveExactProperty(
              property.argument,
              propertyPath,
              new Set(visitedResolutions),
            );
            if (spreadResolution.certainty !== "absent") return spreadResolution;
            continue;
          }
          if (!isNodeOfType(property, "Property")) continue;
          const keyName = getStaticPropertyKeyName(property, {
            allowComputedString: true,
            stringifyNonStringLiterals: true,
          });
          if (!keyName) return unknownResolution();
          if (keyName !== propertyName) continue;
          return resolveExactProperty(
            property.value,
            remainingPropertyPath,
            new Set(visitedResolutions),
          );
        }
        return absentResolution();
      }
      if (isNodeOfType(unwrappedExpression, "ArrayExpression")) {
        const [propertyName, ...remainingPropertyPath] = propertyPath;
        const elementIndex = Number(propertyName);
        if (!Number.isInteger(elementIndex) || elementIndex < 0) return absentResolution();
        let staticElementIndex = 0;
        for (const element of unwrappedExpression.elements) {
          if (isNodeOfType(element, "SpreadElement")) return unknownResolution();
          if (staticElementIndex === elementIndex) {
            return element
              ? resolveExactProperty(element, remainingPropertyPath, new Set(visitedResolutions))
              : absentResolution();
          }
          staticElementIndex += 1;
        }
        return absentResolution();
      }
      if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
        return combineResolutions([
          resolveExactProperty(
            unwrappedExpression.consequent,
            propertyPath,
            new Set(visitedResolutions),
          ),
          resolveExactProperty(
            unwrappedExpression.alternate,
            propertyPath,
            new Set(visitedResolutions),
          ),
        ]);
      }
      if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
        return combineResolutions([
          resolveExactProperty(unwrappedExpression.left, propertyPath, new Set(visitedResolutions)),
          resolveExactProperty(
            unwrappedExpression.right,
            propertyPath,
            new Set(visitedResolutions),
          ),
        ]);
      }
      return absentResolution();
    };

    const collectKnownRegistryKeys = (
      expression: EsTreeNode,
      visitedSymbolIds: Set<number>,
      propertyPath: string[] = [],
    ): Set<string> => {
      const keys = new Set<string>();
      const unwrappedExpression = stripParenExpression(expression);
      if (isNodeOfType(unwrappedExpression, "Identifier")) {
        const symbol = context.scopes.symbolFor(unwrappedExpression);
        if (!symbol || visitedSymbolIds.has(symbol.id)) return keys;
        const nextVisitedSymbolIds = new Set(visitedSymbolIds).add(symbol.id);
        if (symbol.initializer) {
          const initializerKeys = collectKnownRegistryKeys(
            symbol.initializer,
            nextVisitedSymbolIds,
            propertyPath,
          );
          for (const key of initializerKeys) keys.add(key);
        }
        const aliasSymbolIds = new Set(
          collectConstAliasSymbols(symbol, context.scopes).map((aliasSymbol) => aliasSymbol.id),
        );
        for (const assignment of assignments) {
          const assignmentTarget = stripParenExpression(assignment.node.left);
          if (isNodeOfType(assignmentTarget, "Identifier")) {
            if (context.scopes.symbolFor(assignmentTarget) !== symbol) continue;
            if (assignment.isUnconditionalProgramWrite && assignment.node.operator === "=") {
              keys.clear();
              for (const key of collectKnownRegistryKeys(
                assignment.node.right,
                nextVisitedSymbolIds,
                propertyPath,
              )) {
                keys.add(key);
              }
            }
            continue;
          }
          if (!isNodeOfType(assignmentTarget, "MemberExpression")) continue;
          const memberAccess = getMemberAccess(assignmentTarget, context);
          if (!isNodeOfType(memberAccess.root, "Identifier")) continue;
          const rootSymbol = context.scopes.symbolFor(memberAccess.root);
          if (!rootSymbol || !aliasSymbolIds.has(rootSymbol.id)) continue;
          if (propertyPath.length === 0) {
            const firstProperty = memberAccess.properties[0];
            if (firstProperty) keys.add(firstProperty);
            continue;
          }
          const hasMatchingPrefix = propertyPath.every(
            (property, propertyIndex) => memberAccess.properties[propertyIndex] === property,
          );
          if (!hasMatchingPrefix) continue;
          const addedProperty = memberAccess.properties[propertyPath.length];
          if (addedProperty) keys.add(addedProperty);
        }
        return keys;
      }
      if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
        const memberAccess = getMemberAccess(unwrappedExpression, context);
        if (memberAccess.properties.some((property) => property === null)) return keys;
        return collectKnownRegistryKeys(memberAccess.root, visitedSymbolIds, [
          ...memberAccess.properties.filter((property) => property !== null),
          ...propertyPath,
        ]);
      }
      if (isNodeOfType(unwrappedExpression, "ObjectExpression")) {
        if (propertyPath.length > 0) {
          const [propertyName, ...remainingPropertyPath] = propertyPath;
          if (!propertyName) return keys;
          for (const property of unwrappedExpression.properties.toReversed()) {
            if (isNodeOfType(property, "SpreadElement")) {
              const spreadKeys = collectKnownRegistryKeys(
                property.argument,
                visitedSymbolIds,
                propertyPath,
              );
              if (spreadKeys.size > 0) return spreadKeys;
              continue;
            }
            if (!isNodeOfType(property, "Property")) continue;
            const keyName = getStaticPropertyKeyName(property, {
              allowComputedString: true,
              stringifyNonStringLiterals: true,
            });
            if (!keyName) return keys;
            if (keyName === propertyName) {
              return collectKnownRegistryKeys(
                property.value,
                visitedSymbolIds,
                remainingPropertyPath,
              );
            }
          }
          return keys;
        }
        for (const property of unwrappedExpression.properties) {
          if (isNodeOfType(property, "SpreadElement")) {
            const spreadKeys = collectKnownRegistryKeys(property.argument, visitedSymbolIds);
            for (const key of spreadKeys) keys.add(key);
            continue;
          }
          if (!isNodeOfType(property, "Property")) continue;
          const keyName = getStaticPropertyKeyName(property, {
            allowComputedString: true,
            stringifyNonStringLiterals: true,
          });
          if (keyName) keys.add(keyName);
        }
        return keys;
      }
      if (isNodeOfType(unwrappedExpression, "ArrayExpression")) {
        if (propertyPath.length > 0) {
          if (
            unwrappedExpression.elements.some((element) => isNodeOfType(element, "SpreadElement"))
          ) {
            return keys;
          }
          const [propertyName, ...remainingPropertyPath] = propertyPath;
          const elementIndex = Number(propertyName);
          if (!Number.isInteger(elementIndex) || elementIndex < 0) return keys;
          const element = unwrappedExpression.elements[elementIndex];
          return element
            ? collectKnownRegistryKeys(element, visitedSymbolIds, remainingPropertyPath)
            : keys;
        }
        for (const [elementIndex, element] of unwrappedExpression.elements.entries()) {
          if (!element) continue;
          if (!isNodeOfType(element, "SpreadElement")) keys.add(String(elementIndex));
        }
        return keys;
      }
      if (
        isNodeOfType(unwrappedExpression, "ConditionalExpression") ||
        isNodeOfType(unwrappedExpression, "LogicalExpression")
      ) {
        const branchExpressions = isNodeOfType(unwrappedExpression, "ConditionalExpression")
          ? [unwrappedExpression.consequent, unwrappedExpression.alternate]
          : [unwrappedExpression.left, unwrappedExpression.right];
        for (const branchExpression of branchExpressions) {
          const branchKeys = collectKnownRegistryKeys(
            branchExpression,
            visitedSymbolIds,
            propertyPath,
          );
          for (const key of branchKeys) keys.add(key);
        }
        return keys;
      }
      return keys;
    };

    const resolveDynamicRegistry = (
      expression: EsTreeNode,
      visitedResolutions: Set<string>,
      propertyPath: string[] = [],
    ): FamilyResolution => {
      const unwrappedExpression = stripParenExpression(expression);
      if (isNodeOfType(unwrappedExpression, "Identifier")) {
        const symbol = context.scopes.symbolFor(unwrappedExpression);
        if (symbol?.initializer) {
          const aliasSymbolIds = new Set(
            collectConstAliasSymbols(symbol, context.scopes).map((aliasSymbol) => aliasSymbol.id),
          );
          const hasTrackedWrite = assignments.some((assignment) => {
            const assignmentTarget = stripParenExpression(assignment.node.left);
            if (isNodeOfType(assignmentTarget, "Identifier")) {
              return context.scopes.symbolFor(assignmentTarget) === symbol;
            }
            if (!isNodeOfType(assignmentTarget, "MemberExpression")) return false;
            const memberAccess = getMemberAccess(assignmentTarget, context);
            if (!isNodeOfType(memberAccess.root, "Identifier")) return false;
            const rootSymbol = context.scopes.symbolFor(memberAccess.root);
            return Boolean(rootSymbol && aliasSymbolIds.has(rootSymbol.id));
          });
          const pushCalls = mutationCalls.filter((mutationCall) => {
            const callee = stripParenExpression(mutationCall.node.callee);
            if (
              !isNodeOfType(callee, "MemberExpression") ||
              getStaticPropertyName(callee) !== "push"
            ) {
              return false;
            }
            const receiver = stripParenExpression(callee.object);
            if (!isNodeOfType(receiver, "Identifier")) return false;
            const receiverSymbol = context.scopes.symbolFor(receiver);
            return Boolean(receiverSymbol && aliasSymbolIds.has(receiverSymbol.id));
          });
          if (!hasTrackedWrite) {
            const baseResolution = resolveDynamicRegistry(
              symbol.initializer,
              visitedResolutions,
              propertyPath,
            );
            if (propertyPath.length > 0 || pushCalls.length === 0) return baseResolution;
            const pushResolutions = pushCalls.flatMap((mutationCall) => {
              if (!mutationCall.isUnconditionalProgramCall) return [unknownResolution()];
              return mutationCall.node.arguments.map((argument) =>
                isNodeOfType(argument, "SpreadElement")
                  ? resolveDynamicRegistry(argument.argument, new Set(visitedResolutions))
                  : resolveExpressionValue(argument, new Set(visitedResolutions)),
              );
            });
            return combineResolutions([baseResolution, ...pushResolutions]);
          }
        }
      }
      if (propertyPath.length === 0 && isNodeOfType(unwrappedExpression, "ArrayExpression")) {
        const resolutions = unwrappedExpression.elements.flatMap((element) => {
          if (!element) return [];
          return [
            isNodeOfType(element, "SpreadElement")
              ? resolveDynamicRegistry(element.argument, new Set(visitedResolutions))
              : resolveExpressionValue(element, new Set(visitedResolutions)),
          ];
        });
        return combineResolutions(resolutions);
      }
      const registryKeys = collectKnownRegistryKeys(expression, new Set(), propertyPath);
      const families = new Set<string>();
      for (const key of registryKeys) {
        const propertyResolution = resolveExactProperty(
          expression,
          [...propertyPath, key],
          new Set(visitedResolutions),
        );
        if (propertyResolution.certainty !== "known") continue;
        for (const family of propertyResolution.families) families.add(family);
      }
      return knownResolution(families);
    };

    const resolveRenderedName = (renderedName: EsTreeNode): FamilyResolution => {
      if (isNodeOfType(renderedName, "JSXMemberExpression")) {
        const memberAccess = getJsxMemberAccess(renderedName);
        return memberAccess
          ? resolveExactProperty(memberAccess.root, memberAccess.properties, new Set())
          : knownResolution();
      }
      return isNodeOfType(renderedName, "JSXIdentifier")
        ? resolveExpressionValue(renderedName, new Set())
        : knownResolution();
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programNode = node;
      },
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (isTypeOnlyImport(node) || node.specifiers.length === 0) return;
        const source = node.source.value;
        if (typeof source !== "string") return;
        const family = getIconLibraryFamily(source);
        if (!family || NON_INTERCHANGEABLE_ICON_FAMILIES.has(family)) return;
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") {
            continue;
          }
          if (!specifier.local) continue;
          const symbol = context.scopes.symbolFor(specifier.local);
          if (!symbol) continue;
          for (const aliasSymbol of collectConstAliasSymbols(symbol, context.scopes)) {
            iconFamiliesBySymbolId.set(aliasSymbol.id, family);
          }
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        assignments.push({
          isUnconditionalProgramWrite: isUnconditionalProgramWrite(node),
          node,
        });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        mutationCalls.push({
          isUnconditionalProgramCall: isUnconditionalProgramCall(node),
          node,
        });
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        renderedNames.push(node.name);
      },
      "Program:exit"() {
        for (const renderedName of renderedNames) {
          const resolution = resolveRenderedName(renderedName);
          if (resolution.certainty !== "known") continue;
          for (const family of resolution.families) renderedFamilies.add(family);
        }
        if (!programNode || renderedFamilies.size < MIXED_ICON_LIBRARY_MIN_FAMILY_COUNT) return;
        context.report({
          node: programNode,
          message: `This file combines ${[...renderedFamilies].join(", ")}. Keep one icon family so the interface has consistent visual weight and proportions.`,
        });
      },
    };
  },
});
