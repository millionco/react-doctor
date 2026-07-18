import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findSameFileTypeDeclarations } from "../../utils/find-same-file-type-declaration.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// A whole-object parameter default is discarded as soon as a caller passes
// any object. Per-key defaults, required property types, and complete local
// call sites prove when an omitted key cannot lose observable behavior.

const getStaticPropertyKey = (property: EsTreeNodeOfType<"Property">): string | null => {
  if (property.computed) return null;
  const key = property.key as EsTreeNode;
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal")) return String(key.value);
  return null;
};

// Keys of bindings that carry no `= default` of their own — the bindings
// whose fallback the whole-object default silently drops on a
// partial-argument call.
const collectUndefaultedBindingKeys = (
  objectPattern: EsTreeNodeOfType<"ObjectPattern">,
): Set<string> => {
  const undefaultedBindingKeys = new Set<string>();
  for (const property of objectPattern.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (isNodeOfType(property.value as EsTreeNode, "AssignmentPattern")) continue;
    const bindingKey = getStaticPropertyKey(property);
    if (bindingKey !== null) undefaultedBindingKeys.add(bindingKey);
  }
  return undefaultedBindingKeys;
};

interface DroppedFallback {
  key: string;
  value: EsTreeNode;
}

// The default-object values that a partial call actually drops: each
// `key: value` whose key matches an undefaulted binding.
const collectDroppedFallbacks = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  undefaultedBindingKeys: Set<string>,
): Array<DroppedFallback> => {
  const droppedFallbacks: Array<DroppedFallback> = [];
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyKey = getStaticPropertyKey(property);
    if (propertyKey === null || !undefaultedBindingKeys.has(propertyKey)) continue;
    droppedFallbacks.push({ key: propertyKey, value: property.value as EsTreeNode });
  }
  return droppedFallbacks;
};

// An `undefined` fallback IS what the key resolves to when dropped, so
// losing it changes nothing.
const isUndefinedValue = (value: EsTreeNode, context: RuleContext): boolean => {
  const innerValue = stripParenExpression(value);
  if (isNodeOfType(innerValue, "Identifier")) {
    return innerValue.name === "undefined" && context.scopes.isGlobalReference(innerValue);
  }
  return isNodeOfType(innerValue, "UnaryExpression") && innerValue.operator === "void";
};

const getPatternBindingForKey = (
  objectPattern: EsTreeNodeOfType<"ObjectPattern">,
  key: string,
): EsTreeNodeOfType<"Identifier"> | null => {
  for (const property of objectPattern.properties ?? []) {
    if (!isNodeOfType(property, "Property") || getStaticPropertyKey(property) !== key) continue;
    if (isNodeOfType(property.value, "Identifier")) return property.value;
  }
  return null;
};

const isNoOpFunctionValue = (value: EsTreeNode, context: RuleContext): boolean => {
  const unwrappedValue = stripParenExpression(value);
  if (!isFunctionLike(unwrappedValue)) return false;
  if (!isNodeOfType(unwrappedValue.body, "BlockStatement")) {
    return Boolean(unwrappedValue.body && isUndefinedValue(unwrappedValue.body, context));
  }
  return unwrappedValue.body.body.every(
    (statement) =>
      isNodeOfType(statement, "EmptyStatement") ||
      (isNodeOfType(statement, "ReturnStatement") && !statement.argument),
  );
};

const bindingIsOnlyOptionallyCalled = (
  binding: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(binding);
  if (!symbol) return false;
  return symbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    return Boolean(
      parent &&
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === referenceRoot &&
      parent.optional === true,
    );
  });
};

const isNoOpOptionalCallbackFallback = (
  fallback: DroppedFallback,
  objectPattern: EsTreeNodeOfType<"ObjectPattern">,
  context: RuleContext,
): boolean => {
  if (!isNoOpFunctionValue(fallback.value, context)) return false;
  const binding = getPatternBindingForKey(objectPattern, fallback.key);
  return binding !== null && bindingIsOnlyOptionallyCalled(binding, context);
};

const getTypeMemberKey = (member: EsTreeNode): string | null => {
  if (!isNodeOfType(member, "TSPropertySignature") && !isNodeOfType(member, "TSMethodSignature")) {
    return null;
  }
  if (member.computed) return null;
  if (isNodeOfType(member.key, "Identifier")) return member.key.name;
  if (isNodeOfType(member.key, "Literal")) return String(member.key.value);
  return null;
};

const isRequiredTypeMember = (member: EsTreeNode, propertyName: string): boolean => {
  if (!isNodeOfType(member, "TSPropertySignature") && !isNodeOfType(member, "TSMethodSignature")) {
    return false;
  }
  return getTypeMemberKey(member) === propertyName && member.optional !== true;
};

const typeProvesRequiredProperty = (
  typeNode: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  visitedDeclarations: Set<EsTreeNode>,
): boolean => {
  if (isNodeOfType(typeNode, "TSTypeAnnotation")) {
    return typeProvesRequiredProperty(
      typeNode.typeAnnotation,
      propertyName,
      referenceNode,
      visitedDeclarations,
    );
  }
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    return typeNode.members.some((member) => isRequiredTypeMember(member, propertyName));
  }
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) {
    if (visitedDeclarations.has(typeNode)) return false;
    visitedDeclarations.add(typeNode);
    const isRequired =
      typeNode.body.body.some((member) => isRequiredTypeMember(member, propertyName)) ||
      (typeNode.extends ?? []).some((extension) => {
        if (extension.typeArguments || !isNodeOfType(extension.expression, "Identifier")) {
          return false;
        }
        return findSameFileTypeDeclarations(referenceNode, extension.expression.name).some(
          (declaration) =>
            !visitedDeclarations.has(declaration) &&
            typeProvesRequiredProperty(
              declaration,
              propertyName,
              referenceNode,
              visitedDeclarations,
            ),
        );
      });
    visitedDeclarations.delete(typeNode);
    return isRequired;
  }
  if (isNodeOfType(typeNode, "TSIntersectionType")) {
    return typeNode.types.some((intersectionMember) =>
      typeProvesRequiredProperty(
        intersectionMember,
        propertyName,
        referenceNode,
        visitedDeclarations,
      ),
    );
  }
  if (isNodeOfType(typeNode, "TSUnionType")) {
    return typeNode.types.every((unionMember) =>
      typeProvesRequiredProperty(unionMember, propertyName, referenceNode, visitedDeclarations),
    );
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    if (visitedDeclarations.has(typeNode)) return false;
    visitedDeclarations.add(typeNode);
    const isRequired = typeProvesRequiredProperty(
      typeNode.typeAnnotation,
      propertyName,
      referenceNode,
      visitedDeclarations,
    );
    visitedDeclarations.delete(typeNode);
    return isRequired;
  }
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier")
  ) {
    return false;
  }
  return findSameFileTypeDeclarations(referenceNode, typeNode.typeName.name).some(
    (declaration) =>
      !visitedDeclarations.has(declaration) &&
      typeProvesRequiredProperty(declaration, propertyName, referenceNode, visitedDeclarations),
  );
};

const patternTypeRequiresEveryFallback = (
  objectPattern: EsTreeNodeOfType<"ObjectPattern">,
  fallbacks: ReadonlyArray<DroppedFallback>,
): boolean => {
  const annotation = objectPattern.typeAnnotation;
  if (!annotation) return false;
  return fallbacks.every((fallback) =>
    typeProvesRequiredProperty(annotation, fallback.key, objectPattern, new Set()),
  );
};

// True when the AssignmentPattern is a direct parameter of a function
// (not a nested destructuring default inside another pattern).
const isFunctionParameter = (assignmentPattern: EsTreeNode): boolean => {
  const parent = assignmentPattern.parent;
  return Boolean(
    parent &&
    isFunctionLike(parent) &&
    parent.params?.some((parameter) => parameter === assignmentPattern),
  );
};

interface LocalFunctionBinding {
  name: string;
  bindingIdentifier: EsTreeNode;
}

// The identifier a plain `function f` declaration or `const f = () => {}`
// declarator binds the function to — null for inline callbacks, methods,
// and any exported form (an export means callers we cannot see).
const resolveUnexportedFunctionBinding = (
  functionNode: EsTreeNode,
): LocalFunctionBinding | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    const declarationParent = functionNode.parent;
    if (declarationParent && declarationParent.type.startsWith("Export")) return null;
    return { name: functionNode.id.name, bindingIdentifier: functionNode.id as EsTreeNode };
  }
  const declarator = functionNode.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "Identifier")) return null;
  const declaration = declarator.parent;
  if (declaration?.parent && declaration.parent.type.startsWith("Export")) return null;
  return { name: declarator.id.name, bindingIdentifier: declarator.id as EsTreeNode };
};

// A spread-free object-literal argument statically providing every
// at-risk key — such a call can never trigger the dropped fallbacks.
const callArgumentCoversKeys = (
  argument: EsTreeNode,
  atRiskKeys: Set<string>,
  context: RuleContext,
): boolean => {
  const stripped = stripParenExpression(argument);
  if (isUndefinedValue(stripped, context)) return true;
  if (!isNodeOfType(stripped, "ObjectExpression")) return false;
  const providedKeys = new Set<string>();
  for (const property of stripped.properties ?? []) {
    if (!isNodeOfType(property, "Property")) return false;
    const propertyKey = getStaticPropertyKey(property);
    if (propertyKey !== null) providedKeys.add(propertyKey);
  }
  return [...atRiskKeys].every((atRiskKey) => providedKeys.has(atRiskKey));
};

// Whole-file reference scan: true only when the function has at least one
// in-file call and EVERY reference is a direct call that either omits the
// argument entirely (the whole-object default applies intact) or passes an
// object literal covering every at-risk key. Any bare/JSX/exported use means
// unknown callers, so the guard declines.
const everyCallSitePassesAtRiskKeys = (
  functionNode: EsTreeNode,
  parameterIndex: number,
  atRiskKeys: Set<string>,
  context: RuleContext,
): boolean => {
  const binding = resolveUnexportedFunctionBinding(functionNode);
  if (!binding) return false;
  const symbol = context.scopes.symbolFor(binding.bindingIdentifier);
  if (!symbol) return false;
  let sawCompleteCall = false;
  let sawUnknowableReference = false;
  for (const reference of symbol.references) {
    if (sawUnknowableReference) break;
    const child = reference.identifier;
    const parent = child.parent;
    if (!parent) continue;
    if (isNodeOfType(parent, "MemberExpression") && parent.property === child && !parent.computed) {
      continue;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === child &&
      !parent.computed &&
      !parent.shorthand
    ) {
      continue;
    }
    if (isNodeOfType(parent, "CallExpression") && parent.callee === child) {
      const argument = parent.arguments?.[parameterIndex];
      if (!isAstNode(argument) || callArgumentCoversKeys(argument, atRiskKeys, context)) {
        sawCompleteCall = true;
        continue;
      }
    }
    sawUnknowableReference = true;
  }
  return sawCompleteCall && !sawUnknowableReference;
};

export const noWholeObjectDefaultLosingPerKeyDefaults = defineRule({
  id: "no-whole-object-default-losing-per-key-defaults",
  title: "Whole-object param default loses per-key defaults",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "A whole-object parameter default applies only when the argument is omitted entirely, so a partial argument makes every omitted key undefined. Move each fallback onto its own binding instead: `({ a = 1, b = false } = {})`.",
  create: (context: RuleContext): RuleVisitors => ({
    AssignmentPattern(node: EsTreeNodeOfType<"AssignmentPattern">) {
      if (!isFunctionParameter(node)) return;
      const pattern = node.left as EsTreeNode;
      const defaultValue = stripParenExpression(node.right as EsTreeNode);
      if (!isNodeOfType(pattern, "ObjectPattern")) return;
      if (!isNodeOfType(defaultValue, "ObjectExpression")) return;
      const undefaultedBindingKeys = collectUndefaultedBindingKeys(pattern);
      if (undefaultedBindingKeys.size === 0) return;
      const droppedFallbacks = collectDroppedFallbacks(defaultValue, undefaultedBindingKeys);
      if (droppedFallbacks.length === 0) return;
      const observableDroppedFallbacks = droppedFallbacks.filter(
        (fallback) =>
          !isUndefinedValue(fallback.value, context) &&
          !isNoOpOptionalCallbackFallback(fallback, pattern, context),
      );
      if (observableDroppedFallbacks.length === 0) return;
      if (patternTypeRequiresEveryFallback(pattern, observableDroppedFallbacks)) return;
      const enclosingFunction = node.parent;
      if (enclosingFunction && isFunctionLike(enclosingFunction)) {
        const parameterIndex = (enclosingFunction.params ?? []).findIndex(
          (parameter) => parameter === node,
        );
        const atRiskKeys = new Set(observableDroppedFallbacks.map((fallback) => fallback.key));
        if (
          parameterIndex >= 0 &&
          everyCallSitePassesAtRiskKeys(enclosingFunction, parameterIndex, atRiskKeys, context)
        ) {
          return;
        }
      }
      context.report({
        node,
        message:
          "This whole-object default is discarded the moment a caller passes any object, so every omitted key becomes undefined instead of falling back. Give each binding its own default instead: `({ a = 1, b = false } = {})`.",
      });
    },
  }),
});
