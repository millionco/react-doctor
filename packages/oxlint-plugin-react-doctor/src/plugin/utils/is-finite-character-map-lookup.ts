import {
  FINITE_CHARACTER_MAP_ASCII_CODE_UNIT_LIMIT,
  FINITE_CHARACTER_MAP_CAPABILITY_PROPERTIES,
  FINITE_CHARACTER_MAP_COERCION_PROPERTIES,
  FINITE_CHARACTER_MAP_GLOBAL_NAMES,
  FINITE_CHARACTER_MAP_MINIMUM_PATTERN_LENGTH,
  FINITE_CHARACTER_MAP_REPLACE_ARGUMENT_COUNT,
  FINITE_CHARACTER_MAP_RUNTIME_TYPESCRIPT_NODES,
  FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT,
  FINITE_CHARACTER_MAP_UNSUPPORTED_CLASS_CHARACTERS,
} from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const nativePrograms = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

const hasNativeCharacterMapProviders = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let programs = nativePrograms.get(scopes);
  if (!programs) {
    programs = new WeakMap();
    nativePrograms.set(scopes, programs);
  }
  const cached = programs.get(program);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (FINITE_CHARACTER_MAP_RUNTIME_TYPESCRIPT_NODES.has(node.type)) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "ImportDeclaration")
    )
      return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, scopes);
      if (
        FINITE_CHARACTER_MAP_CAPABILITY_PROPERTIES.has(name ?? "") ||
        ((name === "replace" || FINITE_CHARACTER_MAP_COERCION_PROPERTIES.has(name ?? "")) &&
          isMemberMutationTarget(node))
      )
        supported = false;
    }
    if (
      isNodeOfType(node, "Property") ||
      isNodeOfType(node, "MethodDefinition") ||
      isNodeOfType(node, "PropertyDefinition")
    ) {
      const name = getStaticPropertyKeyName(node);
      if (
        FINITE_CHARACTER_MAP_COERCION_PROPERTIES.has(name ?? "") ||
        FINITE_CHARACTER_MAP_CAPABILITY_PROPERTIES.has(name ?? "")
      )
        supported = false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (FINITE_CHARACTER_MAP_GLOBAL_NAMES.has(node.name)) {
      const root = findTransparentExpressionRoot(node);
      const call = root.parent;
      if (
        node.name !== "String" ||
        !scopes.isGlobalReference(node) ||
        hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(node), node.name) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== root ||
        call.optional ||
        call.arguments.length !== FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT ||
        isNodeOfType(call.arguments[0], "SpreadElement")
      )
        supported = false;
    }
    if (isProvenGlobalObjectReference(node, scopes)) {
      const root = findTransparentExpressionRoot(node);
      const member = root.parent;
      const name =
        isNodeOfType(member, "MemberExpression") && member.object === root
          ? getResolvedStaticPropertyName(member, scopes)
          : null;
      if (name === null || FINITE_CHARACTER_MAP_GLOBAL_NAMES.has(name)) supported = false;
    }
  });
  programs.set(program, supported);
  return supported;
};

export const isFiniteCharacterMapLookup = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    !node.computed ||
    node.optional ||
    !isNodeOfType(node.property, "Identifier")
  )
    return false;
  const record = stripParenExpression(node.object);
  if (!isNodeOfType(record, "ObjectExpression")) return false;
  const result = findTransparentExpressionRoot(node);
  const parent = result.parent;
  const callback = isNodeOfType(parent, "ReturnStatement") ? parent.parent?.parent : parent;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    stripParenExpression(getSingleReturnExpression(callback) ?? callback) !== node
  )
    return false;
  const invocation = callback.parent;
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.arguments.length !== FINITE_CHARACTER_MAP_REPLACE_ARGUMENT_COUNT ||
    invocation.arguments[1] !== callback
  )
    return false;
  const replacement = stripParenExpression(invocation.callee);
  if (
    !isNodeOfType(replacement, "MemberExpression") ||
    replacement.computed ||
    replacement.optional ||
    !isNodeOfType(replacement.property, "Identifier") ||
    replacement.property.name !== "replace"
  )
    return false;
  const conversion = stripParenExpression(replacement.object);
  if (
    !isNodeOfType(conversion, "CallExpression") ||
    conversion.optional ||
    conversion.arguments.length !== FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT ||
    isNodeOfType(conversion.arguments[0], "SpreadElement") ||
    !isNodeOfType(conversion.callee, "Identifier") ||
    conversion.callee.name !== "String" ||
    !scopes.isGlobalReference(conversion.callee) ||
    hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(conversion.callee), "String")
  )
    return false;
  const regex = invocation.arguments[0];
  if (!isNodeOfType(regex, "Literal") || !("regex" in regex) || regex.regex.flags !== "g")
    return false;
  const pattern = regex.regex.pattern;
  if (
    pattern.length < FINITE_CHARACTER_MAP_MINIMUM_PATTERN_LENGTH ||
    !pattern.startsWith("[") ||
    !pattern.endsWith("]")
  )
    return false;
  const alphabet = pattern.slice(
    FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT,
    -FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT,
  );
  const characters = new Set<string>();
  for (const character of alphabet) {
    if (
      character.length !== FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT ||
      character.charCodeAt(0) >= FINITE_CHARACTER_MAP_ASCII_CODE_UNIT_LIMIT ||
      FINITE_CHARACTER_MAP_UNSUPPORTED_CLASS_CHARACTERS.has(character) ||
      characters.has(character)
    )
      return false;
    characters.add(character);
  }
  if (record.properties.length !== characters.size) return false;
  const keys = new Set<string>();
  for (const property of record.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.shorthand ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Literal") ||
      typeof property.value.value !== "string"
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    if (key === null || !characters.has(key) || keys.has(key)) return false;
    keys.add(key);
  }
  const parameter = scopes.symbolFor(callback.params[0]);
  const program = findProgramRoot(node);
  return Boolean(
    parameter &&
    program &&
    scopes.symbolFor(node.property) === parameter &&
    hasCompleteSymbolReferences(parameter, program, scopes) &&
    parameter.references.length === FINITE_CHARACTER_MAP_SINGLE_ARGUMENT_COUNT &&
    parameter.references.every(
      (reference) =>
        reference.identifier === node.property &&
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier),
    ) &&
    hasNativeCharacterMapProviders(program, scopes),
  );
};
