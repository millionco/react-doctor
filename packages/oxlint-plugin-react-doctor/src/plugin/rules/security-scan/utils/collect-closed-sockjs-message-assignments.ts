import { hasVisibleAmbientFunctionDeclaration } from "../../../utils/has-visible-ambient-function-declaration.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../utils/attach-parent-references.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasOnlyErasedTypeNameBindings } from "../../../utils/has-only-erased-type-name-bindings.js";
import { getGlobalRequireModuleSource } from "../../../utils/get-global-require-module-source.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const DYNAMIC_PROVIDER_PROPERTIES = new Set([
  "constructor",
  "eval",
  "Function",
  "require",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getPrototypeOf",
  "__proto__",
  "setPrototypeOf",
  "_cache",
  "_load",
  "createRequire",
  "getBuiltinModule",
]);

const isNonReferenceProperty = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (parent?.type === "MemberExpression") return parent.property === node && !parent.computed;
  if (parent?.type === "Property") {
    return parent.key === node && !parent.computed && !parent.shorthand;
  }
  return (
    (parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") &&
    parent.key === node &&
    !parent.computed
  );
};

const isProgramDeclarator = (node: EsTreeNode): boolean => {
  const declaration = node.parent;
  return (
    node.type === "VariableDeclarator" &&
    declaration?.type === "VariableDeclaration" &&
    declaration.declarations.length === 1 &&
    declaration.parent?.type === "Program" &&
    (declaration.kind === "var" || declaration.kind === "let" || declaration.kind === "const")
  );
};

const isPlainHandlerAssignment = (member: EsTreeNode): boolean => {
  const assignment = member.parent;
  return (
    member.type === "MemberExpression" &&
    !member.computed &&
    !member.optional &&
    member.property.type === "Identifier" &&
    (member.property.name === "onmessage" || member.property.name === "onclose") &&
    assignment?.type === "AssignmentExpression" &&
    assignment.left === member &&
    assignment.operator === "=" &&
    assignment.parent?.type === "ExpressionStatement" &&
    assignment.parent.parent?.type === "Program"
  );
};

const hasClosedBindingReferences = (
  symbol: SymbolDescriptor,
  nodes: readonly EsTreeNode[],
  scopes: ScopeAnalysis,
  isAllowedReference: (identifier: EsTreeNode) => boolean,
): boolean => {
  for (const node of nodes) {
    if (node.type !== "Identifier" || node.name !== symbol.name || isNonReferenceProperty(node))
      continue;
    if (node === symbol.bindingIdentifier) continue;
    const reference = scopes.referenceFor(node);
    if (
      !reference ||
      reference.resolvedSymbol !== symbol ||
      reference.flag !== "read" ||
      getNodeStartIndex(node) <= getNodeEndIndex(symbol.declarationNode) ||
      !isAllowedReference(node)
    )
      return false;
  }
  return true;
};

export const collectClosedSockjsMessageAssignments = (
  program: EsTreeNode,
): ReadonlySet<EsTreeNode> => {
  const assignments = new Set<EsTreeNode>();
  attachParentReferences(program);
  const analysis = analyzeScopes(program);
  const scopes: ScopeAnalysis = {
    ...analysis,
    isGlobalReference: (identifier) => {
      if (
        identifier.type === "Identifier" &&
        identifier.name === "require" &&
        hasVisibleAmbientFunctionDeclaration(analysis.scopeFor(identifier), identifier.name)
      )
        return false;
      if (analysis.isGlobalReference(identifier)) return true;
      if (identifier.type !== "Identifier" || identifier.name !== "require") return false;
      const symbol = analysis.symbolFor(identifier);
      return Boolean(symbol && hasOnlyErasedTypeNameBindings(symbol));
    },
  };
  const nodes: EsTreeNode[] = [];
  let hasUnsupportedProvider = false;
  walkAst(program, (node) => {
    if (
      (node.type === "ImportDeclaration" &&
        (node.source.value === "sockjs-client" ||
          node.source.value.startsWith("sockjs-client/"))) ||
      node.type === "WithStatement" ||
      node.type === "ImportExpression" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSParameterProperty" ||
      node.type === "TSExportAssignment" ||
      node.type === "Decorator"
    )
      hasUnsupportedProvider = true;
    if (
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      isTypeScriptTypePosition(node)
    )
      return false;
    nodes.push(node);
    if (
      node.type === "Identifier" &&
      !isNonReferenceProperty(node) &&
      (node.name === "eval" ||
        node.name === "Function" ||
        node.name === "Reflect" ||
        node.name === "globalThis" ||
        node.name === "global" ||
        node.name === "self" ||
        node.name === "arguments")
    )
      hasUnsupportedProvider = true;
    if (
      node.type === "Identifier" &&
      !isNonReferenceProperty(node) &&
      (node.name === "window" || node.name === "Object") &&
      !(node.parent?.type === "MemberExpression" && node.parent.object === node)
    )
      hasUnsupportedProvider = true;
    if (node.type === "MemberExpression") {
      const propertyName = getStaticPropertyName(node);
      const receiver = stripParenExpression(node.object);
      if (
        (propertyName !== null && DYNAMIC_PROVIDER_PROPERTIES.has(propertyName)) ||
        (propertyName === null &&
          receiver.type === "Identifier" &&
          (receiver.name === "window" ||
            receiver.name === "globalThis" ||
            receiver.name === "global" ||
            receiver.name === "self" ||
            receiver.name === "Object"))
      )
        hasUnsupportedProvider = true;
    }
    if (node.type === "Property" && node.parent?.type === "ObjectPattern") {
      const key = node.key;
      let propertyName: string | null = null;
      if (!node.computed && key.type === "Identifier") propertyName = key.name;
      else if (key.type === "Literal" && typeof key.value === "string") propertyName = key.value;
      if (propertyName === null || DYNAMIC_PROVIDER_PROPERTIES.has(propertyName))
        hasUnsupportedProvider = true;
    }
  });
  if (hasUnsupportedProvider) return assignments;

  const canonicalRequires: EsTreeNode[] = [];
  for (const node of nodes) {
    if (node.type !== "Identifier" || node.name !== "require" || isNonReferenceProperty(node))
      continue;
    const reference = scopes.referenceFor(node);
    const call = node.parent;
    if (
      !reference ||
      (reference.resolvedSymbol !== null && !scopes.isGlobalReference(node)) ||
      reference.flag !== "read" ||
      call?.type !== "CallExpression" ||
      call.callee !== node ||
      call.optional ||
      call.arguments.length !== 1
    )
      return assignments;
    const moduleSpecifier = call.arguments[0];
    if (!isNodeOfType(moduleSpecifier, "Literal") || typeof moduleSpecifier.value !== "string")
      return assignments;
    if (
      moduleSpecifier.value.startsWith("sockjs-client/") ||
      moduleSpecifier.value === "module" ||
      moduleSpecifier.value === "node:module"
    )
      return assignments;
    if (moduleSpecifier.value === "sockjs-client") canonicalRequires.push(call);
  }
  if (canonicalRequires.length !== 1) return assignments;
  const requireCall = canonicalRequires[0];
  if (!requireCall || getGlobalRequireModuleSource(requireCall, scopes) !== "sockjs-client")
    return assignments;
  const constructorDeclaration = requireCall.parent;
  if (
    constructorDeclaration?.type !== "VariableDeclarator" ||
    constructorDeclaration.init !== requireCall ||
    constructorDeclaration.id.type !== "Identifier" ||
    !isProgramDeclarator(constructorDeclaration)
  )
    return assignments;
  const constructorSymbol = scopes.symbolFor(constructorDeclaration.id);
  if (!constructorSymbol || constructorSymbol.declarationNode !== constructorDeclaration)
    return assignments;
  if (
    !hasClosedBindingReferences(
      constructorSymbol,
      nodes,
      scopes,
      (identifier) =>
        identifier.parent?.type === "NewExpression" && identifier.parent.callee === identifier,
    )
  )
    return assignments;

  for (const node of nodes) {
    if (
      node.type !== "VariableDeclarator" ||
      node.id.type !== "Identifier" ||
      !node.init ||
      !isProgramDeclarator(node)
    )
      continue;
    const initializer = stripParenExpression(node.init);
    if (
      initializer.type !== "NewExpression" ||
      initializer.callee.type !== "Identifier" ||
      scopes.symbolFor(initializer.callee) !== constructorSymbol ||
      getNodeEndIndex(constructorDeclaration) >= getNodeStartIndex(initializer)
    )
      continue;
    const receiverSymbol = scopes.symbolFor(node.id);
    if (!receiverSymbol || receiverSymbol.declarationNode !== node) continue;
    if (
      !hasClosedBindingReferences(
        receiverSymbol,
        nodes,
        scopes,
        (identifier) =>
          identifier.parent?.type === "MemberExpression" &&
          identifier.parent.object === identifier &&
          isPlainHandlerAssignment(identifier.parent),
      )
    )
      continue;
    for (const reference of receiverSymbol.references) {
      const member = reference.identifier.parent;
      if (
        member?.type === "MemberExpression" &&
        member.property.type === "Identifier" &&
        member.property.name === "onmessage" &&
        isPlainHandlerAssignment(member) &&
        member.parent
      )
        assignments.add(member.parent);
    }
  }
  return assignments;
};
