import { hasStandardReactJsxConfiguration } from "../../../utils/resolve-tsconfig-alias.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../utils/attach-parent-references.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../../utils/find-same-file-type-declaration.js";
import { findVisibleSymbol } from "../../../utils/find-visible-symbol.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";
import {
  REF_NOTIFICATION_RUNTIME_CAPABILITIES,
  REF_NOTIFICATION_RUNTIME_TYPESCRIPT,
} from "./constants.js";

interface TypedReduxStoreFactoryContext extends Pick<
  RuleContext,
  "filename" | "scopes" | "sourceCode"
> {}

const hasClosedRuntimeReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  allowed: ReadonlySet<EsTreeNode>,
): boolean =>
  symbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      isNonReferenceIdentifier(reference.identifier) ||
      (reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        allowed.has(reference.identifier)),
  ) && hasCompleteSymbolReferences(symbol, program, scopes);

const supportedProgramSyntaxByProgram = new WeakMap<EsTreeNode, boolean>();

const hasSupportedProgramSyntax = (program: EsTreeNode): boolean => {
  const cached = supportedProgramSyntaxByProgram.get(program);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      REF_NOTIFICATION_RUNTIME_TYPESCRIPT.has(node.type) ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement")
    ) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    ) {
      if ((node.typeParameters?.params.length ?? 0) > 0) supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      (REF_NOTIFICATION_RUNTIME_CAPABILITIES.has(node.name) ||
        node.name === "global" ||
        node.name === "process" ||
        node.name === "React")
    )
      supported = false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      (getStaticPropertyKeyName(node) === "prototype" ||
        getStaticPropertyKeyName(node) === "constructor" ||
        getStaticPropertyKeyName(node) === "__proto__")
    )
      supported = false;
    if ("typeParameters" in node && node.typeParameters) supported = false;
  });
  supportedProgramSyntaxByProgram.set(program, supported);
  return supported;
};

const isRuntimeNamedImport = (symbol: SymbolDescriptor): boolean => {
  const declaration = getImportDeclarationForSymbol(symbol);
  return Boolean(
    declaration &&
    declaration.importKind !== "type" &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    symbol.declarationNode.importKind !== "type",
  );
};

const hasMatchingExportedStoreType = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  exportedTypeName: string,
  factory: SymbolDescriptor,
): boolean => {
  const declarations = findSameFileTypeDeclarations(program, exportedTypeName);
  const [declaration] = declarations;
  if (
    declarations.length !== 1 ||
    !isNodeOfType(declaration, "TSTypeAliasDeclaration") ||
    declaration.typeParameters ||
    !isNodeOfType(declaration.parent, "ExportNamedDeclaration") ||
    declaration.parent.declaration !== declaration
  )
    return false;
  const annotation = declaration.typeAnnotation;
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    annotation.typeName.name !== "ReturnType" ||
    findVisibleSymbol(annotation.typeName, scopes) ||
    annotation.typeArguments?.params.length !== 1
  )
    return false;
  const [argument] = annotation.typeArguments.params;
  return Boolean(
    isNodeOfType(argument, "TSTypeQuery") &&
    isNodeOfType(argument.exprName, "Identifier") &&
    findVisibleSymbol(argument.exprName, scopes) === factory,
  );
};

const hasFixedReducerMap = (
  options: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedImports: Set<SymbolDescriptor>,
): boolean => {
  if (!isNodeOfType(options, "ObjectExpression") || options.properties.length !== 1) return false;
  const [entry] = options.properties;
  if (
    !isNodeOfType(entry, "Property") ||
    entry.computed ||
    entry.method ||
    entry.kind !== "init" ||
    getStaticPropertyKeyName(entry) !== "reducer" ||
    !isNodeOfType(entry.value, "ObjectExpression") ||
    entry.value.properties.length === 0
  )
    return false;
  const reducerNames = new Set<string>();
  for (const property of entry.value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    const reducer = scopes.symbolFor(property.value);
    const imported = reducer && getImportDeclarationForSymbol(reducer);
    if (
      !name ||
      name === "__proto__" ||
      reducerNames.has(name) ||
      !reducer ||
      !imported ||
      imported.importKind === "type" ||
      isNodeOfType(reducer.declarationNode, "ImportNamespaceSpecifier") ||
      (isNodeOfType(reducer.declarationNode, "ImportSpecifier") &&
        reducer.declarationNode.importKind === "type") ||
      !hasClosedRuntimeReferences(reducer, program, scopes, new Set([property.value]))
    )
      return false;
    reducerNames.add(name);
    allowedImports.add(reducer);
  }
  return true;
};

const hasPrivateGuardedStoreSlot = (
  value: EsTreeNode,
  refSymbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const assignment = value.parent;
  const statement = assignment?.parent;
  const block = statement?.parent;
  const guard = block?.parent;
  if (
    refSymbol.kind !== "const" ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== value ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    block.body.length !== 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== block ||
    guard.alternate ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!"
  )
    return false;
  const guardedRead = guard.test.argument;
  return (
    hasCompleteSymbolReferences(refSymbol, program, scopes) &&
    refSymbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const member = reference.identifier.parent;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== reference.identifier ||
        member.computed ||
        member.optional ||
        getStaticPropertyKeyName(member) !== "current"
      )
        return false;
      if (assignment.left === member || guardedRead === member) return true;
      const container = member.parent;
      const attribute = container?.parent;
      const opening = attribute?.parent;
      if (
        !isNodeOfType(container, "JSXExpressionContainer") ||
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        attribute.name.name !== "store" ||
        !isNodeOfType(opening, "JSXOpeningElement") ||
        !isNodeOfType(opening.name, "JSXIdentifier")
      )
        return false;
      if (opening.attributes.length !== 1 || opening.attributes[0] !== attribute) return false;
      const provider = scopes.symbolFor(opening.name);
      const imported = provider && getImportDeclarationForSymbol(provider);
      const importsAreClosed =
        isNodeOfType(program, "Program") &&
        program.body.every((candidate) => {
          if (
            !isNodeOfType(candidate, "ImportDeclaration") ||
            candidate.source.value !== "react-redux" ||
            candidate.importKind === "type"
          )
            return true;
          return (
            candidate.specifiers.length > 0 &&
            candidate.specifiers.every(
              (specifier) =>
                (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") ||
                specifier === provider?.declarationNode,
            )
          );
        });
      return Boolean(
        provider &&
        imported &&
        importsAreClosed &&
        isRuntimeNamedImport(provider) &&
        imported.source.value === "react-redux" &&
        getImportedName(provider.declarationNode) === "Provider" &&
        hasCompleteSymbolReferences(provider, program, scopes) &&
        provider.references.every((providerReference) => {
          const parent = providerReference.identifier.parent;
          return (
            providerReference.flag === "read" &&
            (isNodeOfType(parent, "JSXOpeningElement") ||
              isNodeOfType(parent, "JSXClosingElement")) &&
            parent.name === providerReference.identifier
          );
        }),
      );
    })
  );
};

export const isTypedReduxStoreFactoryInitialization = (
  value: EsTreeNode,
  refSymbol: SymbolDescriptor,
  context: TypedReduxStoreFactoryContext,
): boolean => {
  const call = stripParenExpression(value);
  const refCall = refSymbol.initializer && stripParenExpression(refSymbol.initializer);
  const consumerProgram = findProgramRoot(value);
  if (
    !consumerProgram ||
    !context.filename ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0 ||
    call.typeArguments ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isNodeOfType(refCall, "CallExpression") ||
    refCall.arguments.length !== 1 ||
    refCall.typeArguments?.params.length !== 1
  )
    return false;
  const factoryImport = context.scopes.symbolFor(call.callee);
  if (
    !factoryImport ||
    !hasClosedRuntimeReferences(
      factoryImport,
      consumerProgram,
      context.scopes,
      new Set([call.callee]),
    )
  )
    return false;
  if (
    !hasRefNotificationReactCall(refCall, "useRef", context) ||
    !hasPrivateGuardedStoreSlot(value, refSymbol, consumerProgram, context.scopes) ||
    !hasSupportedProgramSyntax(consumerProgram) ||
    !hasStandardReactJsxConfiguration(context.filename)
  )
    return false;
  const refProducer = isNodeOfType(refCall.callee, "Identifier")
    ? context.scopes.symbolFor(refCall.callee)
    : null;
  const refImport = refProducer && getImportDeclarationForSymbol(refProducer);
  if (
    !refImport ||
    refImport.source.value !== "react" ||
    resolveModulePath(context.filename, "react") ||
    resolveModulePath(context.filename, "react-redux") ||
    resolveModulePath(context.filename, "react/jsx-runtime") ||
    resolveModulePath(context.filename, "react/jsx-dev-runtime")
  )
    return false;
  const declaredType = refCall.typeArguments.params[0];
  if (
    !isNodeOfType(declaredType, "TSTypeReference") ||
    !isNodeOfType(declaredType.typeName, "Identifier") ||
    declaredType.typeArguments
  )
    return false;
  const typeImport = findVisibleSymbol(declaredType.typeName, context.scopes);
  const factoryDeclaration = factoryImport && getImportDeclarationForSymbol(factoryImport);
  const typeDeclaration = typeImport && getImportDeclarationForSymbol(typeImport);
  if (
    !factoryImport ||
    !isRuntimeNamedImport(factoryImport) ||
    !factoryDeclaration ||
    !typeImport ||
    !typeDeclaration ||
    !isNodeOfType(typeImport.declarationNode, "ImportSpecifier") ||
    factoryDeclaration.source.value !== typeDeclaration.source.value
  )
    return false;
  const factoryName = getImportedName(factoryImport.declarationNode);
  const typeName = getImportedName(typeImport.declarationNode);
  const source = String(factoryDeclaration.source.value);
  const immediatePath = resolveModulePath(context.filename, source);
  if (!factoryName || !typeName || !immediatePath) return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    source,
    factoryName,
  );
  if (
    !resolved ||
    resolved.filePath !== immediatePath ||
    !isNodeOfType(resolved.programNode, "Program") ||
    !isNodeOfType(resolved.functionNode, "ArrowFunctionExpression") ||
    resolved.functionNode.async ||
    resolved.functionNode.params.length !== 0 ||
    resolved.functionNode.typeParameters
  )
    return false;
  const providerProgram = resolved.programNode;
  const factoryFunction = resolved.functionNode;
  attachParentReferences(providerProgram);
  const providerScopes = analyzeScopes(providerProgram);
  const declarator = factoryFunction.parent;
  const declaration = declarator?.parent;
  const exported = declaration?.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(exported, "ExportNamedDeclaration") ||
    exported.parent !== providerProgram ||
    !hasSupportedProgramSyntax(providerProgram)
  )
    return false;
  const factory = providerScopes.symbolFor(declarator.id);
  let returned: EsTreeNode | null = factoryFunction.body;
  if (isNodeOfType(factoryFunction.body, "BlockStatement")) {
    const [statement, ...additionalStatements] = factoryFunction.body.body;
    returned =
      additionalStatements.length === 0 && isNodeOfType(statement, "ReturnStatement")
        ? statement.argument
        : null;
  }
  if (
    !factory ||
    !hasClosedRuntimeReferences(factory, providerProgram, providerScopes, new Set()) ||
    !hasMatchingExportedStoreType(providerProgram, providerScopes, typeName, factory) ||
    !isNodeOfType(returned, "CallExpression") ||
    returned.optional ||
    returned.arguments.length !== 1 ||
    returned.typeArguments ||
    !isNodeOfType(returned.callee, "Identifier")
  )
    return false;
  const configureStore = providerScopes.symbolFor(returned.callee);
  const sdkImport = configureStore && getImportDeclarationForSymbol(configureStore);
  if (
    !configureStore ||
    !isRuntimeNamedImport(configureStore) ||
    !sdkImport ||
    sdkImport.source.value !== "@reduxjs/toolkit" ||
    getImportedName(configureStore.declarationNode) !== "configureStore" ||
    resolveModulePath(resolved.filePath, "@reduxjs/toolkit") ||
    !hasClosedRuntimeReferences(
      configureStore,
      providerProgram,
      providerScopes,
      new Set([returned.callee]),
    )
  )
    return false;
  const allowedImports = new Set([configureStore]);
  if (!hasFixedReducerMap(returned.arguments[0], providerProgram, providerScopes, allowedImports))
    return false;
  return providerProgram.body.every((statement) => {
    if (statement === exported) return true;
    if (isNodeOfType(statement, "ImportDeclaration")) {
      return (
        statement.importKind === "type" ||
        (statement.specifiers.length > 0 &&
          statement.specifiers.every(
            (specifier) =>
              (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") ||
              (() => {
                const binding = providerScopes.symbolFor(specifier.local);
                return Boolean(binding && allowedImports.has(binding));
              })(),
          ))
      );
    }
    return (
      isNodeOfType(statement, "ExportNamedDeclaration") &&
      isNodeOfType(statement.declaration, "TSTypeAliasDeclaration")
    );
  });
};
