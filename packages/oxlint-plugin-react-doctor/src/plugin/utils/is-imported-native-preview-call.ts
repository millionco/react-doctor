import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { executesDuringRender } from "./executes-during-render.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "./has-static-property-write-before.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isSynchronousIteratorCall } from "./is-synchronous-iterator-callback.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { walkAst } from "./walk-ast.js";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  IMPORTED_NATIVE_PREVIEW_DEFINITION_COUNT,
  IMPORTED_NATIVE_PREVIEW_ARRAY_REFUSED_METHOD_NAMES,
  IMPORTED_NATIVE_PREVIEW_SAFE_NAMESPACE_METHODS,
  IMPORTED_NATIVE_PREVIEW_ARRAY_REFUSED_MEMBER_NAMES,
  IMPORTED_NATIVE_PREVIEW_ALLOWED_DIRECTIVES,
  IMPORTED_NATIVE_PREVIEW_EVENT_ATTRIBUTE_PATTERN,
  IMPORTED_NATIVE_PREVIEW_HOST_NAMES,
  IMPORTED_NATIVE_PREVIEW_REFUSED_ATTRIBUTE_NAMES,
} from "../constants/react.js";
import { HTML_TAGS } from "../constants/html-tags.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "./find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { hasUnconfiguredReactJsxEnvironment } from "./has-unconfigured-react-jsx-environment.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isReadonlySymbol = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  !hasSymbolBindingWrites(symbol) &&
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes);

const isPassiveAttributeValue = (
  value: EsTreeNode,
  parameterSymbols: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(value);
  if (isNodeOfType(expression, "Literal"))
    return (
      expression.value === null ||
      typeof expression.value === "string" ||
      typeof expression.value === "boolean" ||
      typeof expression.value === "number"
    );
  const properties = getOwnDataObjectProperties(expression);
  if (properties)
    return [...properties.values()].every((property) =>
      isPassiveAttributeValue(property, parameterSymbols, scopes),
    );
  if (!isNodeOfType(expression, "ConditionalExpression")) return false;
  const condition = stripParenExpression(expression.test);
  const testedParameter =
    isNodeOfType(condition, "UnaryExpression") && condition.operator === "!"
      ? stripParenExpression(condition.argument)
      : condition;
  const testedSymbol = isNodeOfType(testedParameter, "Identifier")
    ? scopes.symbolFor(testedParameter)
    : null;
  return Boolean(
    testedSymbol &&
    parameterSymbols.has(testedSymbol) &&
    isPassiveAttributeValue(expression.consequent, parameterSymbols, scopes) &&
    isPassiveAttributeValue(expression.alternate, parameterSymbols, scopes),
  );
};

const getNativePreviewSourceParameterIndex = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): number | null => {
  if (
    (!isNodeOfType(functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionDeclaration")) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length === 0 ||
    functionNode.params.some(
      (parameter) => !isNodeOfType(parameter, "Identifier") || parameter.name === "React",
    )
  )
    return null;
  const binding = getDirectFunctionBindingIdentifier(functionNode);
  if (binding) {
    const symbols = scopes.rootScope.symbols.filter(
      (symbol) => symbol.bindingIdentifier === binding,
    );
    const [symbol] = symbols;
    if (
      symbols.length !== IMPORTED_NATIVE_PREVIEW_DEFINITION_COUNT ||
      !symbol ||
      symbol.name === "React" ||
      (symbol.kind !== "const" && symbol.kind !== "function") ||
      symbol.scope !== scopes.rootScope ||
      !isReadonlySymbol(symbol, scopes)
    )
      return null;
  } else if (
    !isNodeOfType(functionNode.parent, "ExportDefaultDeclaration") ||
    functionNode.parent.declaration !== functionNode
  )
    return null;
  const parameters = functionNode.params.flatMap((parameter) => {
    const symbol = scopes.symbolFor(parameter);
    return symbol ? [symbol] : [];
  });
  const parameterSymbols = new Set(parameters);
  if (
    parameters.length !== functionNode.params.length ||
    parameterSymbols.size !== parameters.length
  )
    return null;
  const returned = getSingleReturnExpression(functionNode);
  if (!returned) return null;
  const element = stripParenExpression(returned);
  if (
    !isNodeOfType(element, "JSXElement") ||
    !element.openingElement.selfClosing ||
    element.children.length !== 0 ||
    !isNodeOfType(element.openingElement.name, "JSXIdentifier") ||
    !IMPORTED_NATIVE_PREVIEW_HOST_NAMES.has(element.openingElement.name.name)
  )
    return null;
  let sourceParameter: SymbolDescriptor | null = null;
  let sourceIdentifier: EsTreeNode | null = null;
  const seenNames = new Set<string>();
  for (const attribute of element.openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute") || !isNodeOfType(attribute.name, "JSXIdentifier"))
      return null;
    const name = attribute.name.name;
    if (
      seenNames.has(name) ||
      IMPORTED_NATIVE_PREVIEW_REFUSED_ATTRIBUTE_NAMES.has(name) ||
      IMPORTED_NATIVE_PREVIEW_EVENT_ATTRIBUTE_PATTERN.test(name)
    )
      return null;
    seenNames.add(name);
    if (name === "src") {
      if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
      const expression = stripParenExpression(attribute.value.expression);
      if (!isNodeOfType(expression, "Identifier")) return null;
      sourceParameter = scopes.symbolFor(expression);
      sourceIdentifier = expression;
      if (!sourceParameter || !parameterSymbols.has(sourceParameter)) return null;
    } else if (attribute.value) {
      const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
        ? attribute.value.expression
        : attribute.value;
      if (!isPassiveAttributeValue(value, parameterSymbols, scopes)) return null;
    }
  }
  if (
    !sourceParameter ||
    !sourceIdentifier ||
    !hasOnlyAllowedSymbolReads({
      symbol: sourceParameter,
      allowedIdentifiers: new Set([sourceIdentifier]),
      program: scopes.rootScope.node,
      scopes,
    })
  )
    return null;
  return parameters.indexOf(sourceParameter);
};

const isPassivePreviewModule = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  const functions = new Set<EsTreeNode>();
  const exportedIdentifiers: EsTreeNode[] = [];
  for (const statement of program.body) {
    if (
      isNodeOfType(statement, "TSTypeAliasDeclaration") ||
      isNodeOfType(statement, "TSInterfaceDeclaration") ||
      (isNodeOfType(statement, "ImportDeclaration") && statement.importKind === "type") ||
      (isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(statement.expression, "Literal") &&
        typeof statement.expression.value === "string" &&
        IMPORTED_NATIVE_PREVIEW_ALLOWED_DIRECTIVES.has(statement.expression.value))
    )
      continue;
    let declaration: EsTreeNode = statement;
    if (isNodeOfType(statement, "ExportNamedDeclaration")) {
      if (statement.exportKind === "type") continue;
      if (statement.source) return false;
      if (!statement.declaration) {
        for (const specifier of statement.specifiers) {
          if (
            !isNodeOfType(specifier, "ExportSpecifier") ||
            !isNodeOfType(specifier.local, "Identifier")
          )
            return false;
          exportedIdentifiers.push(specifier.local);
        }
        continue;
      }
      declaration = statement.declaration;
    } else if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      if (isNodeOfType(statement.declaration, "Identifier")) {
        exportedIdentifiers.push(statement.declaration);
        continue;
      }
      declaration = statement.declaration;
    }
    if (isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "const") {
      for (const declarator of declaration.declarations) {
        if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) return false;
        const initializer = stripParenExpression(declarator.init);
        if (getNativePreviewSourceParameterIndex(initializer, scopes) === null) return false;
        functions.add(initializer);
      }
    } else if (
      isNodeOfType(declaration, "FunctionDeclaration") ||
      (isNodeOfType(statement, "ExportDefaultDeclaration") &&
        (isNodeOfType(declaration, "ArrowFunctionExpression") ||
          isNodeOfType(declaration, "FunctionExpression")))
    ) {
      if (getNativePreviewSourceParameterIndex(declaration, scopes) === null) return false;
      functions.add(declaration);
    } else return false;
  }
  return (
    functions.size > 0 &&
    exportedIdentifiers.every((identifier) => {
      const symbol = scopes.symbolFor(identifier);
      return Boolean(
        symbol?.initializer && functions.has(stripParenExpression(symbol.initializer)),
      );
    })
  );
};

const hasVisibleArrayMapOverride = (receiver: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(receiver);
  if (
    isNodeOfType(expression, "Identifier") &&
    (hasPossibleStaticPropertyWrite(expression, "map", scopes) ||
      hasPossibleStaticPropertyWrite(expression, "__proto__", scopes))
  )
    return true;
  const receiverSymbols = new Set(
    isNodeOfType(expression, "Identifier") ? getEquivalentSymbols(expression, scopes) : [],
  );
  let hasCapability = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasCapability) return false;
    for (const [namespace, safeMethods] of IMPORTED_NATIVE_PREVIEW_SAFE_NAMESPACE_METHODS) {
      const binding = isNodeOfType(node, "Identifier") ? scopes.symbolFor(node) : null;
      const isErasedGlobal =
        isNodeOfType(node, "Identifier") &&
        node.name === namespace &&
        Boolean(
          scopes.referenceFor(node) &&
          binding &&
          isErasedTypeScriptBinding(binding) &&
          !hasRuntimeValueBinding(binding),
        );
      if (!isErasedGlobal && !isProvenGlobalNamespaceReference(node, namespace, scopes)) continue;
      const namespaceRoot = findTransparentExpressionRoot(node);
      const member = namespaceRoot.parent;
      const memberRoot = member ? findTransparentExpressionRoot(member) : null;
      const invocation = memberRoot?.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== namespaceRoot ||
        member.optional ||
        !safeMethods.has(getStaticPropertyName(member) ?? "") ||
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.optional ||
        invocation.callee !== memberRoot
      ) {
        hasCapability = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      isMemberMutationTarget(node) &&
      (getStaticPropertyName(node) === null ||
        getStaticPropertyName(node) === "map" ||
        getStaticPropertyName(node) === "__proto__")
    ) {
      hasCapability = true;
      return false;
    }
    if (
      (isNodeOfType(node, "Identifier") &&
        isProvenGlobalNamespaceReference(node, "Array", scopes) &&
        scopes.referenceFor(node)?.flag !== "read") ||
      (isNodeOfType(node, "MemberExpression") &&
        isProvenGlobalNamespaceReference(node.object, "Array", scopes) &&
        (getStaticPropertyName(node) === "prototype" || isMemberMutationTarget(node)))
    ) {
      hasCapability = true;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const root = getRootIdentifier(node);
      const rootSymbol = root ? scopes.symbolFor(root) : null;
      if (
        (isProvenGlobalNamespaceReference(node, "Array", scopes) && isMemberMutationTarget(node)) ||
        (rootSymbol &&
          receiverSymbols.has(rootSymbol) &&
          IMPORTED_NATIVE_PREVIEW_ARRAY_REFUSED_MEMBER_NAMES.has(getStaticPropertyName(node) ?? ""))
      ) {
        hasCapability = true;
        return false;
      }
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      IMPORTED_NATIVE_PREVIEW_ARRAY_REFUSED_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      (isProvenGlobalNamespaceReference(callee.object, "Object", scopes) ||
        isProvenGlobalNamespaceReference(callee.object, "Reflect", scopes))
    )
      hasCapability = true;
  });
  return hasCapability;
};

const getArrayLiteralOrigin = (
  value: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<SymbolDescriptor>(),
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  const expression = stripParenExpression(value);
  if (hasVisibleArrayMapOverride(expression, scopes)) return null;
  if (isNodeOfType(expression, "ArrayExpression")) return expression;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbols.has(symbol) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !isReadonlySymbol(symbol, scopes)
  )
    return null;
  visitedSymbols.add(symbol);
  return getArrayLiteralOrigin(symbol.initializer, scopes, visitedSymbols);
};

const hasPotentialArrayElements = (
  array: EsTreeNodeOfType<"ArrayExpression">,
  stateSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
  visitedArrays = new Set<EsTreeNode>(),
): boolean => {
  if (visitedArrays.has(array)) return false;
  visitedArrays.add(array);
  return array.elements.some((element) => {
    if (!element) return false;
    if (!isNodeOfType(element, "SpreadElement")) return true;
    const value = stripParenExpression(element.argument);
    if (stateSymbol && isNodeOfType(value, "Identifier") && scopes.symbolFor(value) === stateSymbol)
      return false;
    const origin = getArrayLiteralOrigin(value, scopes);
    return origin ? hasPotentialArrayElements(origin, stateSymbol, scopes, visitedArrays) : true;
  });
};

const isNativeArrayStateReceiver = (receiver: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(receiver);
  if (!isNodeOfType(expression, "Identifier") || hasVisibleArrayMapOverride(expression, scopes))
    return false;
  const stateSymbol = scopes.symbolFor(expression);
  const declaration = stateSymbol?.declarationNode;
  if (
    !stateSymbol ||
    stateSymbol.kind !== "const" ||
    !isReadonlySymbol(stateSymbol, scopes) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    declaration.id.elements[0] !== stateSymbol.bindingIdentifier ||
    !isNodeOfType(declaration.id.elements[1], "Identifier") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.arguments.length !== 1 ||
    !isNodeOfType(declaration.init.arguments[0], "ArrayExpression") ||
    !isReactApiCall(declaration.init, "useState", scopes, { allowUnboundBareCalls: false }) ||
    !isProvenUnmodifiedReactApiCall(declaration.init, "useState", scopes) ||
    hasReactDefaultProviderMutation("useState", scopes)
  )
    return false;
  const hookIdentifier = getRootIdentifier(declaration.init.callee);
  const hookSymbol = hookIdentifier ? scopes.symbolFor(hookIdentifier) : null;
  if (
    !hookSymbol ||
    getImportDeclarationForSymbol(hookSymbol)?.source.value !== "react" ||
    !isReadonlySymbol(hookSymbol, scopes)
  )
    return false;
  const pair = resolveReactUseStatePair(declaration.id.elements[1], scopes);
  if (
    !pair ||
    pair.declarator !== declaration ||
    pair.stateSymbol !== stateSymbol ||
    !isReadonlySymbol(pair.setterSymbol, scopes)
  )
    return false;
  let hasPotentialElements = hasPotentialArrayElements(
    declaration.init.arguments[0],
    stateSymbol,
    scopes,
  );
  const allWritesAreArrayPayloads = pair.setterSymbol.references.every((reference) => {
    if (
      reference.identifier === pair.setterSymbol.bindingIdentifier ||
      isNonReferenceIdentifier(reference.identifier)
    )
      return true;
    const setterRoot = findTransparentExpressionRoot(reference.identifier);
    const call = setterRoot.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== setterRoot ||
      call.arguments.length !== 1 ||
      isNodeOfType(call.arguments[0], "SpreadElement")
    )
      return false;
    const payload = getArrayLiteralOrigin(call.arguments[0], scopes);
    if (!payload) return false;
    hasPotentialElements ||= hasPotentialArrayElements(payload, stateSymbol, scopes);
    return true;
  });
  return allWritesAreArrayPayloads && hasPotentialElements;
};

const isNativeMapValueCarrier = (
  call: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  const callbackFunction = stripParenExpression(callback);
  if (
    call.optional ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== "map" ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== callback ||
    !isFunctionLike(callbackFunction) ||
    callbackFunction.async ||
    callbackFunction.generator ||
    hasVisibleArrayMapOverride(callee.object, scopes)
  )
    return false;
  const literalOrigin = getArrayLiteralOrigin(callee.object, scopes);
  if (literalOrigin && !hasPotentialArrayElements(literalOrigin, null, scopes)) return false;
  return (
    (executesDuringRender(callbackFunction, scopes, {
      requireProvenSynchronousCallbackReceiver: true,
    }) &&
      isSynchronousIteratorCall(call, callback, scopes)) ||
    isNativeArrayStateReceiver(callee.object, scopes)
  );
};

const hasUnmanagedNativeChildSink = (call: EsTreeNode, context: RuleContext): boolean => {
  const owner = findRenderPhaseComponentOrHook(call, context.scopes);
  const ownerName = owner ? componentOrHookDisplayNameForFunction(owner) : null;
  if (!owner || !ownerName || isReactHookName(ownerName)) return false;
  let valueRoot = findTransparentExpressionRoot(call);
  let sawNativeChild = false;
  while (valueRoot !== owner) {
    const parent: EsTreeNode | null | undefined = valueRoot.parent;
    if (!parent) return false;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === valueRoot || parent.alternate === valueRoot)) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === valueRoot)
    ) {
      valueRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "JSXExpressionContainer") &&
      (isNodeOfType(parent.parent, "JSXElement") || isNodeOfType(parent.parent, "JSXFragment"))
    ) {
      sawNativeChild ||= isNodeOfType(parent.parent, "JSXElement");
      valueRoot = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXElement")) {
      const opening = parent.openingElement;
      if (
        !isNodeOfType(opening.name, "JSXIdentifier") ||
        !HTML_TAGS.has(opening.name.name) ||
        opening.attributes.some(
          (attribute) =>
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier") ||
            IMPORTED_NATIVE_PREVIEW_REFUSED_ATTRIBUTE_NAMES.has(attribute.name.name) ||
            IMPORTED_NATIVE_PREVIEW_EVENT_ATTRIBUTE_PATTERN.test(attribute.name.name),
        )
      )
        return false;
      valueRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "JSXFragment")) {
      valueRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === valueRoot) {
      const block: EsTreeNode | null | undefined = parent.parent;
      if (!isNodeOfType(block, "BlockStatement") || !isFunctionLike(block.parent)) return false;
      const functionNode: EsTreeNode = block.parent;
      if (functionNode === owner) return sawNativeChild;
      valueRoot = findTransparentExpressionRoot(functionNode);
      continue;
    }
    if (isFunctionLike(parent) && parent.body === valueRoot) {
      if (parent === owner) return sawNativeChild;
      valueRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "CallExpression") &&
      isNativeMapValueCarrier(parent, valueRoot, context.scopes)
    ) {
      valueRoot = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return sawNativeChild;
};

export const isImportedNativePreviewCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  createdValue: EsTreeNode,
  context: RuleContext,
): boolean => {
  const filename = context.filename;
  const callee = stripParenExpression(call.callee);
  if (
    !filename ||
    call.optional ||
    !isNodeOfType(callee, "Identifier") ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !hasUnmanagedNativeChildSink(call, context)
  )
    return false;
  const importSymbol = context.scopes.symbolFor(callee);
  if (!importSymbol || !isReadonlySymbol(importSymbol, context.scopes)) return false;
  const declaration = getImportDeclarationForSymbol(importSymbol);
  if (
    !declaration ||
    declaration.importKind === "type" ||
    typeof declaration.source.value !== "string" ||
    !declaration.source.value.startsWith(".")
  )
    return false;
  const specifier = importSymbol.declarationNode;
  const importedName = isNodeOfType(specifier, "ImportDefaultSpecifier")
    ? "default"
    : isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind !== "type"
      ? getImportedName(specifier)
      : null;
  if (!importedName) return false;
  const absoluteFilename = path.resolve(filename);
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    absoluteFilename,
    declaration.source.value,
    importedName,
    { requireCompleteReexports: true },
  );
  if (
    !resolved ||
    resolved.contexts?.length !== IMPORTED_NATIVE_PREVIEW_DEFINITION_COUNT ||
    resolved.contexts[0]?.role !== "definition" ||
    findNearestPackageDirectory(absoluteFilename) !== findNearestPackageDirectory(resolved.filePath)
  )
    return false;
  let producerText: string;
  try {
    producerText = fs.readFileSync(resolved.filePath, "utf8");
  } catch {
    return false;
  }
  const callerText = context.sourceCode?.getText?.();
  if (
    callerText === undefined ||
    !hasUnconfiguredReactJsxEnvironment({
      filename: absoluteFilename,
      program: context.scopes.rootScope.node,
      sourceText: callerText,
    }) ||
    !hasUnconfiguredReactJsxEnvironment({
      filename: resolved.filePath,
      program: resolved.programNode,
      sourceText: producerText,
    })
  )
    return false;
  const producerScopes = analyzeScopes(resolved.programNode);
  if (!isPassivePreviewModule(resolved.programNode, producerScopes)) return false;
  const parameterIndex = getNativePreviewSourceParameterIndex(
    resolved.functionNode,
    producerScopes,
  );
  return Boolean(
    parameterIndex !== null &&
    (isNodeOfType(resolved.functionNode, "FunctionDeclaration") ||
      isNodeOfType(resolved.functionNode, "FunctionExpression") ||
      isNodeOfType(resolved.functionNode, "ArrowFunctionExpression")) &&
    call.arguments.length === resolved.functionNode.params.length &&
    call.arguments[parameterIndex] &&
    stripParenExpression(call.arguments[parameterIndex]) === createdValue,
  );
};
