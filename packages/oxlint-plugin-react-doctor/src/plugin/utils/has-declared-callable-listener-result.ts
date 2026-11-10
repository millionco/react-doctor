import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { walkAst } from "./walk-ast.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isStableLogicalReceiver } from "./is-stable-logical-receiver.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findSameFileTypeDeclarations } from "./find-same-file-type-declaration.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const declaredFactoriesByAnalysis = new WeakMap<
  ScopeAnalysis,
  ReadonlyMap<string, EsTreeNode | null>
>();

const getDeclaredFactory = (callee: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (
    !isNodeOfType(callee, "Identifier") ||
    context.scopes.symbolFor(callee) ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      callee,
      callee.name,
      context.scopes,
      undefined,
      true,
    )
  )
    return null;
  let declarations = declaredFactoriesByAnalysis.get(context.scopes);
  if (!declarations) {
    const program = findProgramRoot(callee);
    if (!isNodeOfType(program, "Program")) return null;
    const declarationsByName = new Map<string, EsTreeNode | null>();
    for (const statement of program.body) {
      if (!isNodeOfType(statement, "TSDeclareFunction") || !statement.id) continue;
      const name = statement.id.name;
      declarationsByName.set(name, declarationsByName.has(name) ? null : statement);
    }
    let referencesGlobalObject = false;
    walkAst(program, (node) => {
      if (referencesGlobalObject) return false;
      if (isNodeOfType(node, "Identifier") && isProvenGlobalObjectReference(node, context.scopes)) {
        referencesGlobalObject = true;
      }
    });
    if (referencesGlobalObject) declarationsByName.clear();
    declarations = declarationsByName;
    declaredFactoriesByAnalysis.set(context.scopes, declarations);
  }
  return declarations.get(callee.name) ?? null;
};

const resolveDeclaredProviderType = (
  annotation: EsTreeNode,
  visitedTypeNames = new Set<string>(),
): EsTreeNode | null => {
  if (isNodeOfType(annotation, "TSTypeLiteral")) return annotation;
  if (isNodeOfType(annotation, "TSUnionType")) {
    const providerTypes = annotation.types.filter(
      (typeNode) =>
        !isNodeOfType(typeNode, "TSUndefinedKeyword") &&
        !(
          isNodeOfType(typeNode, "TSLiteralType") &&
          isNodeOfType(typeNode.literal, "Literal") &&
          typeNode.literal.value === null
        ),
    );
    return providerTypes.length === 1
      ? resolveDeclaredProviderType(providerTypes[0], visitedTypeNames)
      : null;
  }
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    annotation.typeArguments ||
    visitedTypeNames.has(annotation.typeName.name)
  ) {
    return null;
  }
  visitedTypeNames.add(annotation.typeName.name);
  const declarations = findSameFileTypeDeclarations(annotation, annotation.typeName.name);
  if (declarations.length !== 1) return null;
  const declaration = declarations[0];
  if (isNodeOfType(declaration, "TSTypeAliasDeclaration")) {
    return declaration.typeParameters
      ? null
      : resolveDeclaredProviderType(declaration.typeAnnotation, visitedTypeNames);
  }
  return isNodeOfType(declaration, "TSInterfaceDeclaration") &&
    !declaration.typeParameters &&
    declaration.extends.length === 0
    ? declaration.body
    : null;
};

const getDeclaredProviderMethod = (
  providerType: EsTreeNode,
  methodName: string,
): EsTreeNode | null => {
  const members = isNodeOfType(providerType, "TSTypeLiteral")
    ? providerType.members
    : isNodeOfType(providerType, "TSInterfaceBody")
      ? providerType.body
      : [];
  const methods = members.filter(
    (member) =>
      (isNodeOfType(member, "TSPropertySignature") || isNodeOfType(member, "TSMethodSignature")) &&
      getStaticKeyName(member.key) === methodName,
  );
  if (methods.length !== 1) return null;
  const method = methods[0];
  if (
    (isNodeOfType(method, "TSMethodSignature") || isNodeOfType(method, "TSPropertySignature")) &&
    (method.computed || method.optional)
  )
    return null;
  if (isNodeOfType(method, "TSMethodSignature")) return method;
  return isNodeOfType(method, "TSPropertySignature") &&
    isNodeOfType(method.typeAnnotation?.typeAnnotation, "TSFunctionType")
    ? method.typeAnnotation.typeAnnotation
    : null;
};

const resolveDeclaredReceiverType = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode | null => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const symbol = context.scopes.symbolFor(receiver);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !isStableLogicalReceiver(receiver, context.scopes)
    )
      return null;
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectUnreassignedInitializer(symbol);
    return initializer ? resolveDeclaredReceiverType(initializer, context, visitedSymbolIds) : null;
  }
  if (!isNodeOfType(receiver, "CallExpression") || receiver.arguments.length !== 0) return null;
  const callee = stripParenExpression(receiver.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    if (callee.computed || getStaticPropertyName(callee) !== "getParent") return null;
    const providerType = resolveDeclaredReceiverType(callee.object, context, visitedSymbolIds);
    const parentMethod = providerType ? getDeclaredProviderMethod(providerType, "getParent") : null;
    return (isNodeOfType(parentMethod, "TSFunctionType") ||
      isNodeOfType(parentMethod, "TSMethodSignature")) &&
      !parentMethod.typeParameters &&
      parentMethod.returnType
      ? resolveDeclaredProviderType(parentMethod.returnType.typeAnnotation)
      : null;
  }
  const declaration = getDeclaredFactory(callee, context);
  return isNodeOfType(declaration, "TSDeclareFunction") &&
    declaration.params.length === 0 &&
    !declaration.typeParameters &&
    declaration.returnType
    ? resolveDeclaredProviderType(declaration.returnType.typeAnnotation)
    : null;
};

export const hasDeclaredCallableListenerResult = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean => {
  const providerType = resolveDeclaredReceiverType(expression, context);
  const listenerMethod = providerType
    ? getDeclaredProviderMethod(providerType, "addListener")
    : null;
  if (
    (!isNodeOfType(listenerMethod, "TSFunctionType") &&
      !isNodeOfType(listenerMethod, "TSMethodSignature")) ||
    listenerMethod.typeParameters
  )
    return false;
  const returnType = listenerMethod.returnType;
  const disposerType = isNodeOfType(returnType, "TSTypeAnnotation")
    ? returnType.typeAnnotation
    : null;
  return (
    isNodeOfType(disposerType, "TSFunctionType") &&
    disposerType.params.length === 0 &&
    !disposerType.typeParameters &&
    isNodeOfType(disposerType.returnType?.typeAnnotation, "TSVoidKeyword")
  );
};
