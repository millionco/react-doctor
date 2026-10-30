import { parseSync } from "oxc-parser";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import {
  getReactDoctorStringSetting,
  hasCapability,
  hasCapabilityOrUnspecified,
} from "../../../utils/get-react-doctor-setting.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  CSF2_BIND_ARGUMENT_COUNT,
  CSF2_FORBIDDEN_PROPERTY_NAMES,
  CSF2_JSX_PRAGMA_PATTERN,
  CSF2_REACT_PROVIDER_MODULES,
  CSF2_SINGLE_ROLE_COUNT,
  CSF2_UNSUPPORTED_GLOBAL_NAMES,
  CSF2_UNSUPPORTED_TYPESCRIPT_NODES,
} from "./constants.js";

const statementIndicesByProgram = new WeakMap<
  EsTreeNodeOfType<"Program">,
  ReadonlyMap<EsTreeNode, number>
>();
const dataUseProofsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

const isReadonlyValueSymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => isTypeScriptTypePosition(reference.identifier) || reference.flag === "read",
  );

const isDirectJsxName = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === node,
  );
};

const readTopLevelConst = (
  identifier: EsTreeNode,
  context: RuleContext,
  exported: boolean,
): SymbolDescriptor | null => {
  const symbol = context.scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  if (
    !symbol ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier ||
    !getDirectConstInitializer(symbol) ||
    !isReadonlyValueSymbol(symbol)
  )
    return null;
  const statement = declaration.parent;
  if (!isNodeOfType(statement, "VariableDeclaration")) return null;
  if (exported) {
    return isNodeOfType(statement.parent, "ExportNamedDeclaration") &&
      statement.parent.declaration === statement &&
      isNodeOfType(statement.parent.parent, "Program")
      ? symbol
      : null;
  }
  return isNodeOfType(statement.parent, "Program") ? symbol : null;
};

const readOrdinaryObject = (node: EsTreeNode): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const object = stripParenExpression(node);
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const names = new Set<string>();
  for (const property of object.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || names.has(name) || CSF2_FORBIDDEN_PROPERTY_NAMES.has(name)) return null;
    names.add(name);
  }
  return object;
};

const hasClosedUnknownComputedDataUse = (node: EsTreeNode, context: RuleContext): boolean => {
  let proofs = dataUseProofsByScopes.get(context.scopes);
  if (!proofs) {
    proofs = new WeakMap();
    dataUseProofsByScopes.set(context.scopes, proofs);
  }
  const cached = proofs.get(node);
  if (cached !== undefined) return cached;
  const pending = [node];
  const visited = new Set<EsTreeNode>();
  let closed = true;
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    const currentProof = proofs.get(current);
    if (currentProof === true) continue;
    if (currentProof === false) {
      closed = false;
      break;
    }
    visited.add(current);
    const root = findTransparentExpressionRoot(current);
    const parent = root.parent;
    if (isNodeOfType(parent, "ExpressionStatement")) continue;
    if (
      isNodeOfType(parent, "UnaryExpression") &&
      (parent.operator === "!" || parent.operator === "void" || parent.operator === "typeof")
    )
      continue;
    if (
      isNodeOfType(parent, "BinaryExpression") &&
      (parent.operator === "===" || parent.operator === "!==")
    )
      continue;
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test === root) continue;
    if (
      isNodeOfType(parent, "LogicalExpression") ||
      (isNodeOfType(parent, "ConditionalExpression") && parent.test !== root)
    ) {
      pending.push(parent);
      continue;
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === root) {
      const propertyName = getResolvedStaticPropertyName(parent, context.scopes);
      if (propertyName === null || CSF2_FORBIDDEN_PROPERTY_NAMES.has(propertyName)) {
        closed = false;
        break;
      }
      pending.push(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === root &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(parent.id);
      if (
        !symbol ||
        !getDirectConstInitializer(symbol) ||
        !isReadonlyValueSymbol(symbol) ||
        isNodeOfType(parent.parent?.parent, "ExportNamedDeclaration")
      ) {
        closed = false;
        break;
      }
      for (const reference of symbol.references) {
        if (!isTypeScriptTypePosition(reference.identifier)) pending.push(reference.identifier);
      }
      continue;
    }
    closed = false;
    break;
  }
  if (closed) {
    for (const visitedNode of visited) proofs.set(visitedNode, true);
  } else proofs.set(node, false);
  return closed;
};

const hasClosedProgramProviders = (
  program: EsTreeNodeOfType<"Program">,
  componentSource: string,
  component: SymbolDescriptor,
  bindMembers: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const source = context.sourceCode?.getText?.();
  if (source === undefined) return false;
  if (CSF2_JSX_PRAGMA_PATTERN.test(source)) {
    try {
      const parsed = parseSync("csf2-template.tsx", source, { astType: "ts", lang: "tsx" });
      if (
        parsed.errors.some((error) => error.severity === "Error") ||
        parsed.comments.some((comment) => CSF2_JSX_PRAGMA_PATTERN.test(comment.value))
      )
        return false;
    } catch {
      return false;
    }
  }
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    if (
      ("declare" in node && node.declare === true) ||
      CSF2_UNSUPPORTED_TYPESCRIPT_NODES.has(node.type) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
    ) {
      closed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      const reference = context.scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      if (
        reference &&
        ((symbol && isErasedTypeScriptBinding(symbol)) ||
          CSF2_UNSUPPORTED_GLOBAL_NAMES.has(node.name))
      ) {
        closed = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, context.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        (propertyName !== null && CSF2_FORBIDDEN_PROPERTY_NAMES.has(propertyName)) ||
        (propertyName === "bind" && !bindMembers.has(node)) ||
        (propertyName === null &&
          (!isNodeOfType(node, "MemberExpression") ||
            !hasClosedUnknownComputedDataUse(node, context)))
      ) {
        closed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    if (
      !CSF2_REACT_PROVIDER_MODULES.has(String(node.source.value)) &&
      node.source.value !== componentSource
    )
      return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || getValueImportSource(symbol) === null) continue;
      if (!isReadonlyValueSymbol(symbol)) {
        closed = false;
        return false;
      }
      if (node.source.value === componentSource) {
        if (
          symbol !== component &&
          symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
        ) {
          closed = false;
          return false;
        }
        continue;
      }
      for (const reference of symbol.references) {
        const identifier = reference.identifier;
        if (isTypeScriptTypePosition(identifier) || isDirectJsxName(identifier)) continue;
        const parent = identifier.parent;
        if (
          isNodeOfType(specifier, "ImportSpecifier") &&
          isNodeOfType(parent, "CallExpression") &&
          parent.callee === identifier &&
          !parent.optional
        )
          continue;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === identifier &&
          !parent.optional &&
          getResolvedStaticPropertyName(parent, context.scopes) !== null &&
          !isMemberMutationTarget(parent) &&
          isNodeOfType(parent.parent, "CallExpression") &&
          parent.parent.callee === parent &&
          !parent.parent.optional
        )
          continue;
        closed = false;
        return false;
      }
    }
  });
  return closed;
};

const hasMetadataComponent = (
  program: EsTreeNodeOfType<"Program">,
  component: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const defaults = program.body.filter((statement) =>
    isNodeOfType(statement, "ExportDefaultDeclaration"),
  );
  if (defaults.length !== CSF2_SINGLE_ROLE_COUNT) return false;
  const declaration = defaults[0];
  if (!isNodeOfType(declaration, "ExportDefaultDeclaration")) return false;
  let value = stripParenExpression(declaration.declaration);
  if (isNodeOfType(value, "Identifier")) {
    const symbol = readTopLevelConst(value, context, false);
    if (!symbol) return false;
    const references = symbol.references.filter(
      (reference) => !isTypeScriptTypePosition(reference.identifier),
    );
    if (
      references.length !== CSF2_SINGLE_ROLE_COUNT ||
      findTransparentExpressionRoot(references[0].identifier).parent !== declaration
    )
      return false;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    value = stripParenExpression(initializer);
  }
  const object = readOrdinaryObject(value);
  if (!object) return false;
  const properties = object.properties.filter(
    (property) =>
      isNodeOfType(property, "Property") && getStaticPropertyKeyName(property) === "component",
  );
  if (properties.length !== CSF2_SINGLE_ROLE_COUNT) return false;
  const property = properties[0];
  if (!isNodeOfType(property, "Property")) return false;
  const selected = stripParenExpression(property.value);
  if (!isNodeOfType(selected, "Identifier") || context.scopes.symbolFor(selected) !== component)
    return false;
  return component.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      isDirectJsxName(reference.identifier) ||
      findTransparentExpressionRoot(reference.identifier) ===
        findTransparentExpressionRoot(selected),
  );
};

const hasClosedStoryArgs = (
  story: SymbolDescriptor,
  program: EsTreeNodeOfType<"Program">,
  statementIndices: ReadonlyMap<EsTreeNode, number>,
): boolean => {
  const exportStatement = story.declarationNode.parent?.parent;
  if (!isNodeOfType(exportStatement, "ExportNamedDeclaration")) return false;
  const declarationIndex = statementIndices.get(exportStatement);
  if (declarationIndex === undefined) return false;
  let assignments = 0;
  for (const reference of story.references) {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) continue;
    const member = identifier.parent;
    const assignment = member?.parent;
    const statement = assignment?.parent;
    const statementIndex = statement ? statementIndices.get(statement) : undefined;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "args" ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.left !== member ||
      assignment.operator !== "=" ||
      !isNodeOfType(statement, "ExpressionStatement") ||
      statement.parent !== program ||
      statementIndex === undefined ||
      statementIndex <= declarationIndex ||
      !readOrdinaryObject(assignment.right)
    )
      return false;
    assignments += 1;
  }
  return assignments === CSF2_SINGLE_ROLE_COUNT;
};

export const isCsf2BoundTemplateForwarding = (
  attribute: EsTreeNodeOfType<"JSXSpreadAttribute">,
  context: RuleContext,
): boolean => {
  if (
    !hasCapabilityOrUnspecified(context.settings, "react") ||
    hasCapability(context.settings, "preact") ||
    hasCapability(context.settings, "pure-preact") ||
    getReactDoctorStringSetting(context.settings, "framework") === "preact"
  )
    return false;
  if (!isNodeOfType(attribute.argument, "Identifier")) return false;
  const functionNode = findEnclosingFunction(attribute);
  if (
    (!isNodeOfType(functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionExpression")) ||
    functionNode.async ||
    functionNode.generator ||
    (isNodeOfType(functionNode, "FunctionExpression") && functionNode.id !== null) ||
    functionNode.params.length !== CSF2_SINGLE_ROLE_COUNT ||
    !isNodeOfType(functionNode.params[0], "Identifier")
  )
    return false;
  const declaration = functionNode.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const template = readTopLevelConst(declaration.id, context, false);
  if (!template || getDirectConstInitializer(template) !== functionNode) return false;
  const returned = getSingleReturnExpression(functionNode);
  if (!isNodeOfType(returned, "JSXElement")) return false;
  const opening = returned.openingElement;
  if (
    opening.attributes.length !== CSF2_SINGLE_ROLE_COUNT ||
    opening.attributes[0] !== attribute ||
    returned.children.length !== 0 ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !/^[A-Z]/u.test(opening.name.name)
  )
    return false;
  const input = context.scopes.symbolFor(functionNode.params[0]);
  const component = context.scopes.symbolFor(opening.name);
  const componentSource = component && getValueImportSource(component);
  if (
    !input ||
    context.scopes.symbolFor(attribute.argument) !== input ||
    !input.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        reference.identifier === attribute.argument,
    ) ||
    !component ||
    !componentSource ||
    isNodeOfType(component.declarationNode, "ImportNamespaceSpecifier") ||
    !isReadonlyValueSymbol(component)
  )
    return false;
  const program = findProgramRoot(attribute);
  if (!isNodeOfType(program, "Program") || !hasMetadataComponent(program, component, context))
    return false;
  let statementIndices = statementIndicesByProgram.get(program);
  if (!statementIndices) {
    const indices = new Map<EsTreeNode, number>();
    for (const [index, statement] of program.body.entries()) {
      if (!indices.has(statement)) indices.set(statement, index);
    }
    statementIndices = indices;
    statementIndicesByProgram.set(program, statementIndices);
  }
  const bindMembers = new Set<EsTreeNode>();
  for (const reference of template.references) {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) continue;
    const member = identifier.parent;
    const call = member?.parent;
    const bound = call?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "bind" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.optional ||
      call.arguments.length !== CSF2_BIND_ARGUMENT_COUNT ||
      !isNodeOfType(call.arguments[0], "ObjectExpression") ||
      call.arguments[0].properties.length !== 0 ||
      !isNodeOfType(bound, "VariableDeclarator") ||
      bound.init !== call ||
      !isNodeOfType(bound.id, "Identifier")
    )
      return false;
    const story = readTopLevelConst(bound.id, context, true);
    const storyStatement = story?.declarationNode.parent?.parent;
    const templateStatement = declaration.parent;
    const storyIndex = storyStatement ? statementIndices.get(storyStatement) : undefined;
    const templateIndex = templateStatement ? statementIndices.get(templateStatement) : undefined;
    if (
      !story ||
      !isNodeOfType(storyStatement, "ExportNamedDeclaration") ||
      !isNodeOfType(templateStatement, "VariableDeclaration") ||
      storyIndex === undefined ||
      templateIndex === undefined ||
      storyIndex <= templateIndex ||
      !hasClosedStoryArgs(story, program, statementIndices)
    )
      return false;
    bindMembers.add(member);
  }
  return (
    bindMembers.size > 0 &&
    hasClosedProgramProviders(program, componentSource, component, bindMembers, context)
  );
};
