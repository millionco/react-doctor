import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  CLASS_UPDATER_REACT_CALL_NAMES,
  CLASS_UPDATER_RENDER_ARGUMENT_COUNT,
  IMPORTED_CLASS_REFUSED_MEMBER_NAMES,
  IMPORTED_CLASS_REFUSED_MODULE_SOURCES,
  IMPORTED_CLASS_REFUSED_GLOBAL_NAMES,
} from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasDynamicScopeAccess } from "./has-dynamic-scope-access.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { isFunctionLike } from "./is-function-like.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { hasStandardReactJsxConfiguration } from "./resolve-tsconfig-alias.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const classSafetyByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

const hasClosedNativeImportReferences = (
  identifier: EsTreeNode,
  source: string,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  const program = findProgramRoot(identifier);
  if (
    !symbol ||
    !program ||
    getValueImportSource(symbol) !== source ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return false;
  return symbol.references.every((reference) => {
    if (reference.flag !== "read") return false;
    let value = findTransparentExpressionRoot(reference.identifier);
    let imported = resolveImportedApiReference(symbol.bindingIdentifier, scopes);
    if (!imported) return false;
    if (imported.isNamespace || imported.importedName === "default") {
      const member = value.parent;
      if (isNodeOfType(member, "JSXMemberExpression") && member.object === value) {
        return source === "react" && member.property.name === "Fragment";
      }
      if (!isNodeOfType(member, "MemberExpression") || member.object !== value || member.optional)
        return false;
      imported = resolveImportedApiReference(member, scopes);
      if (!imported) return false;
      value = findTransparentExpressionRoot(member);
    }
    if (
      source === "react" &&
      (imported.importedName === "Component" || imported.importedName === "PureComponent")
    ) {
      return Boolean(
        (isNodeOfType(value.parent, "ClassDeclaration") ||
          isNodeOfType(value.parent, "ClassExpression")) &&
        value.parent.superClass === value,
      );
    }
    if (source === "react-dom" && imported.importedName === "render") {
      return Boolean(
        isNodeOfType(value.parent, "CallExpression") &&
        value.parent.callee === value &&
        !value.parent.optional,
      );
    }
    return Boolean(
      source === "react" &&
      imported.importedName &&
      CLASS_UPDATER_REACT_CALL_NAMES.has(imported.importedName) &&
      isNodeOfType(value.parent, "CallExpression") &&
      value.parent.callee === value &&
      !value.parent.optional,
    );
  });
};

const isDiscardedNativeClassRender = (element: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const value = findTransparentExpressionRoot(element);
  const call = value.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== CLASS_UPDATER_RENDER_ARGUMENT_COUNT ||
    call.arguments[0] !== value
  )
    return false;
  const discardedCall = findTransparentExpressionRoot(call);
  if (
    !isNodeOfType(discardedCall.parent, "ExpressionStatement") ||
    discardedCall.parent.expression !== discardedCall
  )
    return false;
  const callee = stripParenExpression(call.callee);
  const imported = resolveImportedApiReference(callee, scopes);
  if (imported?.source !== "react-dom" || imported.importedName !== "render") return false;
  const provider = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  return (
    isNodeOfType(provider, "Identifier") &&
    hasClosedNativeImportReferences(provider, "react-dom", scopes)
  );
};

const hasClosedClassReferences = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<SymbolDescriptor>(),
): boolean => {
  const program = findProgramRoot(symbol.declarationNode);
  if (
    !program ||
    visitedSymbols.has(symbol) ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return false;
  visitedSymbols.add(symbol);
  return symbol.references.every((reference) => {
    if (reference.flag !== "read") return false;
    let value = findTransparentExpressionRoot(reference.identifier);
    while (
      (isNodeOfType(value.parent, "LogicalExpression") &&
        (value.parent.left === value || value.parent.right === value)) ||
      (isNodeOfType(value.parent, "ConditionalExpression") &&
        (value.parent.consequent === value || value.parent.alternate === value))
    )
      value = findTransparentExpressionRoot(value.parent);
    const parent = value.parent;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === value &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const alias = scopes.symbolFor(parent.id);
      return Boolean(
        alias?.kind === "const" && hasClosedClassReferences(alias, scopes, new Set(visitedSymbols)),
      );
    }
    if (!isNodeOfType(parent, "JSXOpeningElement") && !isNodeOfType(parent, "JSXClosingElement"))
      return false;
    if (parent.name !== value || !isNodeOfType(parent.parent, "JSXElement")) return false;
    const element = parent.parent;
    return (
      element.openingElement.attributes.every(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name !== "ref",
      ) && isDiscardedNativeClassRender(element, scopes)
    );
  });
};

const hasClosedClassBody = (classNode: EsTreeNode): boolean => {
  if (!isNodeOfType(classNode, "ClassDeclaration") || classNode.decorators.length > 0) return false;
  for (const member of classNode.body.body) {
    if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition"))
      return false;
    const propertyName = getStaticPropertyKeyName(member, { allowComputedString: true });
    if (!propertyName || member.decorators.length > 0 || propertyName === "constructor")
      return false;
    if (!member.static && (propertyName === "setState" || propertyName === "updater")) return false;
  }
  let isClosed = true;
  walkAst(classNode.body, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "Super")) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression")) {
      isClosed = false;
      return false;
    }
    if (!isNodeOfType(node, "ThisExpression")) return;
    const receiver = findTransparentExpressionRoot(node);
    const member = receiver.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      member.optional
    ) {
      isClosed = false;
      return false;
    }
    const propertyName = getStaticPropertyName(member);
    if (
      !propertyName ||
      propertyName === "updater" ||
      propertyName === "valueOf" ||
      IMPORTED_CLASS_REFUSED_MEMBER_NAMES.has(propertyName)
    ) {
      isClosed = false;
      return false;
    }
    let accessedValue: EsTreeNode = member;
    while (isNodeOfType(findTransparentExpressionRoot(accessedValue).parent, "MemberExpression")) {
      const accessedMember: EsTreeNode | null | undefined =
        findTransparentExpressionRoot(accessedValue).parent;
      if (
        !isNodeOfType(accessedMember, "MemberExpression") ||
        stripParenExpression(accessedMember.object) !== accessedValue
      )
        break;
      const accessedName = getStaticPropertyName(accessedMember);
      if (!accessedName || IMPORTED_CLASS_REFUSED_MEMBER_NAMES.has(accessedName)) {
        isClosed = false;
        return false;
      }
      accessedValue = accessedMember;
    }
    if (propertyName === "setState") {
      const method = findTransparentExpressionRoot(member);
      isClosed = Boolean(
        isNodeOfType(method.parent, "CallExpression") &&
        method.parent.callee === method &&
        !method.parent.optional,
      );
    }
  });
  return isClosed;
};

const isClosedNativeClass = (classNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(classNode, "ClassDeclaration") ||
    !classNode.id ||
    !classNode.superClass ||
    !hasClosedClassBody(classNode)
  )
    return false;
  const program = findProgramRoot(classNode);
  if (!program || hasDynamicScopeAccess(scopes)) return false;
  let hasNativeProviderEscape = false;
  walkAst(program, (candidate) => {
    if (hasNativeProviderEscape) return false;
    const source = getRuntimeStaticDependencySource(candidate);
    if (
      isNodeOfType(candidate, "ImportExpression") ||
      (source && IMPORTED_CLASS_REFUSED_MODULE_SOURCES.has(source))
    )
      hasNativeProviderEscape = true;
    for (const globalName of IMPORTED_CLASS_REFUSED_GLOBAL_NAMES) {
      if (isProvenGlobalNamespaceReference(candidate, globalName, scopes))
        hasNativeProviderEscape = true;
    }
    if (isProvenGlobalNamespaceReference(candidate, "require", scopes))
      hasNativeProviderEscape = true;
  });
  if (hasNativeProviderEscape) return false;
  for (const source of ["react", "react-dom"]) {
    for (const provider of scopes.rootScope.symbols) {
      if (
        getValueImportSource(provider) === source &&
        !hasClosedNativeImportReferences(provider.bindingIdentifier, source, scopes)
      )
        return false;
    }
  }
  const superclass = stripParenExpression(classNode.superClass);
  const imported = resolveImportedApiReference(superclass, scopes);
  if (
    imported?.source !== "react" ||
    (imported.importedName !== "Component" && imported.importedName !== "PureComponent")
  )
    return false;
  const provider = isNodeOfType(superclass, "MemberExpression")
    ? stripParenExpression(superclass.object)
    : superclass;
  if (
    !isNodeOfType(provider, "Identifier") ||
    !hasClosedNativeImportReferences(provider, "react", scopes)
  )
    return false;
  if (
    isNodeOfType(classNode.parent, "ExportNamedDeclaration") ||
    isNodeOfType(classNode.parent, "ExportDefaultDeclaration")
  )
    return false;
  const symbol = scopes.symbolFor(classNode.id);
  return Boolean(symbol && hasClosedClassReferences(symbol, scopes));
};

const hasCanonicalClassConfiguration = (context: RuleContext): boolean => {
  const program = context.scopes.rootScope.node;
  const filename = context.filename;
  const sourceText = context.sourceCode?.getText?.();
  if (
    !filename ||
    sourceText === undefined ||
    hasJsxRuntimePragma({ program, filename, sourceText }) ||
    !hasStandardReactJsxConfiguration(filename, { requireUnaliasedReact: true })
  )
    return false;
  return ["react", "react-dom"].every(
    (source) =>
      !resolveWebpackAliasPath(filename, source)?.declared && !resolveModulePath(filename, source),
  );
};

export const isClosedNativeClassStateSetterCall = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  const scopes = context.scopes;
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== "setState" ||
    !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
  )
    return false;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) && !isNodeOfType(ancestor, "ArrowFunctionExpression"))
      return false;
    if (isNodeOfType(ancestor, "PropertyDefinition")) {
      if (
        ancestor.static ||
        !ancestor.value ||
        !isNodeOfType(stripParenExpression(ancestor.value), "ArrowFunctionExpression")
      )
        return false;
      const classNode = ancestor.parent?.parent;
      if (!isNodeOfType(classNode, "ClassDeclaration")) return false;
      let safetyByClass = classSafetyByScopes.get(scopes);
      if (!safetyByClass) {
        safetyByClass = new WeakMap();
        classSafetyByScopes.set(scopes, safetyByClass);
      }
      let isSafe = safetyByClass.get(classNode);
      if (isSafe === undefined) {
        isSafe = isClosedNativeClass(classNode, scopes);
        safetyByClass.set(classNode, isSafe);
      }
      return isSafe && hasCanonicalClassConfiguration(context);
    }
    if (isNodeOfType(ancestor, "ClassDeclaration") || isNodeOfType(ancestor, "ClassExpression"))
      return false;
    ancestor = ancestor.parent;
  }
  return false;
};
