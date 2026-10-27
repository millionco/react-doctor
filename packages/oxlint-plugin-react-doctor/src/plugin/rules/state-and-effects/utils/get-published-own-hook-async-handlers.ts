import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { hasDisjointPreawaitValidationStateWrite } from "./has-disjoint-preawait-validation-state-write.js";
import { hasClosedValidatorEnvironment } from "./has-closed-validator-environment.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getFunctionExportNames } from "../../../utils/get-function-export-names.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getOwnDataObjectProperties } from "../../../utils/get-own-data-object-properties.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { hasUnindexedRuntimeSource } from "../../../utils/has-unindexed-runtime-source.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { isReactComponentOrHookName } from "../../../utils/is-react-component-or-hook-name.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { findNearestPackageDirectory } from "../../../utils/read-nearest-package-manifest.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { hasStandardReactJsxConfiguration } from "../../../utils/resolve-tsconfig-alias.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { visitStaticJsxChildren } from "../../../utils/visit-static-jsx-children.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import { isClosedDataValidator } from "./is-closed-data-validator.js";
import { resolveImportedNativeControlEventProp } from "./resolve-imported-native-control-event-prop.js";
import {
  OWN_HOOK_SINGLE_COUNT,
  OWN_HOOK_FIRST_INDEX,
  OWN_HOOK_REACT_API_NAMES,
  OWN_HOOK_RUNTIME_TS_NODES,
  OWN_HOOK_GUARD_ATTRIBUTES,
  OWN_HOOK_EVENT_NAMES,
  IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES,
} from "./constants.js";

interface OwnedHookHandlerPublicationInput {
  readonly context: RuleContext;
  readonly getUnsafeAwait: (handler: EsTreeNode) => EsTreeNode | null;
}

interface OwnedHookHandlerCandidate {
  readonly hook: EsTreeNode;
  readonly handler: EsTreeNode;
  readonly propertyName: string;
  readonly exportNames: ReadonlyArray<string>;
  readonly unsafeAwait: EsTreeNode | null;
}

interface OwnedValidatorFunction {
  readonly functionNode: EsTreeNode;
  readonly module: AsyncEventSourceModule;
}

const hasOrdinaryHookModule = (module: AsyncEventSourceModule): boolean => {
  if (
    !hasStandardReactJsxConfiguration(module.filename) ||
    resolveModulePath(module.filename, "react") ||
    hasJsxRuntimePragma({
      filename: module.filename,
      program: module.program,
      sourceText: fs.readFileSync(module.filename, "utf8"),
    })
  )
    return false;
  if (
    [...OWN_HOOK_REACT_API_NAMES].some((name) =>
      hasReactDefaultProviderMutation(name, module.scopes),
    )
  )
    return false;
  let supported = true;
  walkAst(module.program, (node) => {
    if (!supported) return false;
    if (OWN_HOOK_RUNTIME_TS_NODES.has(node.type)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration")
    )
      supported = false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      node.source.value !== "react" &&
      node.specifiers.some((value) => isNodeOfType(value, "ImportNamespaceSpecifier"))
    )
      supported = false;
    if (
      isNodeOfType(node, "CallExpression") &&
      isReactApiCall(node, OWN_HOOK_REACT_API_NAMES, module.scopes) &&
      !isProvenUnmodifiedReactApiCall(node, OWN_HOOK_REACT_API_NAMES, module.scopes)
    )
      supported = false;
  });
  return supported;
};

const readOwnedHookReturn = (
  hook: EsTreeNode,
  module: AsyncEventSourceModule,
): OwnedHookHandlerCandidate[] => {
  if (
    !isFunctionLike(hook) ||
    hook.async ||
    hook.generator ||
    !isNodeOfType(hook.body, "BlockStatement") ||
    hook.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return [];
  if (!isNodeOfType(module.program, "Program")) return [];
  const exportNames = getFunctionExportNames(module.program, hook);
  const bindings = getFunctionBindingSymbols(hook, module.scopes);
  if (
    !exportNames.length ||
    bindings.length !== OWN_HOOK_SINGLE_COUNT ||
    !isReactHookName(bindings[OWN_HOOK_FIRST_INDEX].name) ||
    bindings[OWN_HOOK_FIRST_INDEX].scope.kind !== "module" ||
    !hasReadonlyAsyncEventBinding(bindings[OWN_HOOK_FIRST_INDEX], module)
  )
    return [];
  const returns = collectFunctionReturnStatements(hook);
  if (
    returns.length !== OWN_HOOK_SINGLE_COUNT ||
    hook.body.body.at(-OWN_HOOK_SINGLE_COUNT) !== returns[OWN_HOOK_FIRST_INDEX] ||
    !returns[OWN_HOOK_FIRST_INDEX].argument
  )
    return [];
  const returned = stripParenExpression(returns[OWN_HOOK_FIRST_INDEX].argument);
  const properties = getOwnDataObjectProperties(returned);
  if (!properties) return [];
  const candidates: OwnedHookHandlerCandidate[] = [];
  for (const [propertyName, raw] of properties) {
    const value = stripParenExpression(raw);
    if (!isNodeOfType(value, "Identifier")) continue;
    const symbol = module.scopes.symbolFor(value);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !hasReadonlyAsyncEventBinding(symbol, module) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !declaration.init ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const" ||
      declaration.parent.parent !== hook.body
    )
      continue;
    const handler = stripParenExpression(declaration.init);
    if (
      !isFunctionLike(handler) ||
      !handler.async ||
      handler.generator ||
      !isNodeOfType(handler.body, "BlockStatement")
    )
      continue;
    if (
      !hasOnlyAllowedSymbolReads({
        symbol,
        allowedIdentifiers: new Set([value]),
        program: module.program,
        scopes: module.scopes,
      })
    )
      continue;
    candidates.push({ hook, handler, propertyName, exportNames, unsafeAwait: null });
  }
  return candidates;
};

const readValidatorFunction = (
  raw: EsTreeNode,
  module: AsyncEventSourceModule,
): OwnedValidatorFunction | null => {
  const value = stripParenExpression(raw);
  const local = resolveExactLocalFunction(value, module.scopes);
  if (local) {
    const bindings = getFunctionBindingSymbols(local, module.scopes);
    return bindings.every((symbol) => hasReadonlyAsyncEventBinding(symbol, module))
      ? { functionNode: local, module }
      : null;
  }
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(value);
  const imported = getImportBindingForName(module.program, value.name);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !hasReadonlyAsyncEventBinding(symbol, module) ||
    !imported ||
    imported.isNamespace ||
    imported.exportedName === null
  )
    return null;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    module.filename,
    imported.source,
    imported.exportedName,
    { requireCompleteReexports: true },
  );
  if (!resolved?.contexts?.length) return null;
  for (const entry of resolved.contexts) {
    const target = {
      filename: entry.filePath,
      program: entry.programNode,
      scopes: analyzeScopes(entry.programNode),
    };
    if (!hasOrdinaryHookModule(target)) return null;
  }
  const target = {
    filename: resolved.filePath,
    program: resolved.programNode,
    scopes: analyzeScopes(resolved.programNode),
  };
  if (
    !getFunctionBindingSymbols(resolved.functionNode, target.scopes).every((binding) =>
      hasReadonlyAsyncEventBinding(binding, target),
    )
  )
    return null;
  return { functionNode: resolved.functionNode, module: target };
};

const hasClosedHookProjection = (
  candidate: OwnedHookHandlerCandidate,
  call: EsTreeNodeOfType<"CallExpression">,
  owner: AsyncEventSourceModule,
  consumer: AsyncEventSourceModule,
  modules: ReadonlyArray<AsyncEventSourceModule>,
): boolean => {
  if (
    !isFunctionLike(candidate.hook) ||
    call.optional ||
    call.arguments.length !== candidate.hook.params.length ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  const validationCalls = new Set<EsTreeNodeOfType<"CallExpression">>();
  for (const [index, parameter] of candidate.hook.params.entries()) {
    if (!isNodeOfType(parameter, "Identifier")) return false;
    const symbol = owner.scopes.symbolFor(parameter);
    if (!symbol || !hasReadonlyAsyncEventBinding(symbol, owner)) return false;
    const uses = new Set<EsTreeNode>();
    for (const reference of symbol.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      const value = findTransparentExpressionRoot(reference.identifier);
      const invocation = value.parent;
      if (
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.optional ||
        invocation.callee !== value ||
        invocation.arguments.length !== OWN_HOOK_SINGLE_COUNT ||
        findEnclosingFunction(invocation) !== candidate.handler ||
        invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        return false;
      uses.add(reference.identifier);
      validationCalls.add(invocation);
    }
    if (
      !hasOnlyAllowedSymbolReads({
        symbol,
        allowedIdentifiers: uses,
        program: owner.program,
        scopes: owner.scopes,
      })
    )
      return false;
    if (!uses.size) return false;
    const validator = readValidatorFunction(call.arguments[index], consumer);
    if (!validator || !isClosedDataValidator({ ...validator, modules })) return false;
  }
  return (
    candidate.unsafeAwait !== null &&
    hasDisjointPreawaitValidationStateWrite({
      handler: candidate.handler,
      unsafeAwait: candidate.unsafeAwait,
      validationCalls,
      module: owner,
    })
  );
};

const hasEnabledSubmitRoute = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  consumer: AsyncEventSourceModule,
  modules: ReadonlyArray<AsyncEventSourceModule>,
): boolean => {
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  for (const attribute of opening.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (name === "form") return false;
    if (
      name &&
      (OWN_HOOK_GUARD_ATTRIBUTES.has(name) ||
        IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES.has(name) ||
        name === "ref")
    ) {
      if (
        !attribute.value ||
        !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
        readStaticBoolean(attribute.value.expression) !== false
      )
        return false;
    }
  }
  if (opening.name.name === "button") {
    if (
      opening.attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          (getJsxAttributeName(attribute.name) ?? "").startsWith("on"),
      )
    )
      return false;
    const type = getAuthoritativeJsxAttribute(opening.attributes, "type");
    return !type || (isNodeOfType(type.value, "Literal") && type.value.value === "submit");
  }
  const imported = getImportBindingForName(consumer.program, opening.name.name);
  const symbol = consumer.scopes.symbolFor(opening.name);
  if (
    !imported ||
    imported.isNamespace ||
    imported.exportedName === null ||
    !symbol ||
    !hasReadonlyAsyncEventBinding(symbol, consumer)
  )
    return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    consumer.filename,
    imported.source,
    imported.exportedName,
    { requireCompleteReexports: true },
  );
  if (!resolved?.contexts?.length) return false;
  const target = {
    filename: resolved.filePath,
    program: resolved.programNode,
    scopes: analyzeScopes(resolved.programNode),
  };
  const component = resolved.functionNode;
  if (
    !hasOrdinaryHookModule(target) ||
    !isFunctionLike(component) ||
    component.async ||
    component.generator ||
    component.params.length !== OWN_HOOK_SINGLE_COUNT ||
    !isNodeOfType(component.params[OWN_HOOK_FIRST_INDEX], "ObjectPattern")
  )
    return false;
  for (const binding of getFunctionBindingSymbols(component, target.scopes)) {
    const allowed = new Set<EsTreeNode>();
    for (const reference of binding.references) {
      const parent = findTransparentExpressionRoot(reference.identifier).parent;
      if (
        ((isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === reference.identifier) ||
        (isNodeOfType(parent, "ExportSpecifier") && parent.local === reference.identifier) ||
        (isNodeOfType(parent, "ExportDefaultDeclaration") &&
          parent.declaration === reference.identifier)
      )
        allowed.add(reference.identifier);
    }
    if (
      !hasOnlyAllowedSymbolReads({
        symbol: binding,
        allowedIdentifiers: allowed,
        program: target.program,
        scopes: target.scopes,
      })
    )
      return false;
  }
  const returned = getSingleReturnExpression(component);
  if (!returned || !isNodeOfType(stripParenExpression(returned), "JSXElement")) return false;
  const element = stripParenExpression(returned);
  if (!isNodeOfType(element, "JSXElement")) return false;
  const event = getAuthoritativeJsxAttribute(element.openingElement.attributes, "onClick");
  if (
    !event ||
    !event.value ||
    !isNodeOfType(event.value, "JSXExpressionContainer") ||
    !isNodeOfType(stripParenExpression(event.value.expression), "Identifier")
  )
    return false;
  const value = stripParenExpression(event.value.expression);
  const eventSymbol = target.scopes.symbolFor(value);
  let propName: string | null = null;
  for (const property of component.params[OWN_HOOK_FIRST_INDEX].properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    if (target.scopes.symbolFor(property.value) === eventSymbol)
      propName = getStaticPropertyKeyName(property);
  }
  for (const candidateModule of modules) {
    for (const binding of candidateModule.scopes.rootScope.symbols) {
      const importedBinding = getImportBindingForName(candidateModule.program, binding.name);
      if (!importedBinding || importedBinding.isNamespace || importedBinding.exportedName === null)
        continue;
      const targetExport = resolveCrossFileFunctionExportWithFilePath(
        candidateModule.filename,
        importedBinding.source,
        importedBinding.exportedName,
        { requireCompleteReexports: true },
      );
      if (
        !targetExport ||
        targetExport.filePath !== resolved.filePath ||
        targetExport.functionNode.range[OWN_HOOK_FIRST_INDEX] !==
          component.range[OWN_HOOK_FIRST_INDEX]
      )
        continue;
      const allowed = new Set<EsTreeNode>();
      for (const reference of binding.references) {
        const parent = reference.identifier.parent;
        if (
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === reference.identifier
        )
          allowed.add(reference.identifier);
        else if (isNodeOfType(parent, "ExportSpecifier") && parent.local === reference.identifier)
          allowed.add(reference.identifier);
      }
      if (
        !hasOnlyAllowedSymbolReads({
          symbol: binding,
          allowedIdentifiers: allowed,
          program: candidateModule.program,
          scopes: candidateModule.scopes,
        })
      )
        return false;
    }
  }
  if (
    !eventSymbol ||
    !propName ||
    getAuthoritativeJsxAttribute(opening.attributes, propName) ||
    !hasOnlyAllowedSymbolReads({
      symbol: eventSymbol,
      allowedIdentifiers: new Set([value]),
      program: target.program,
      scopes: target.scopes,
    })
  )
    return false;
  const nativeButton =
    isNodeOfType(element.openingElement.name, "JSXIdentifier") &&
    element.openingElement.name.name === "button";
  if (
    !nativeButton &&
    resolveImportedNativeControlEventProp({
      attribute: event,
      context: { filename: target.filename, scopes: target.scopes },
    }) !== event.value.expression
  )
    return false;
  return element.openingElement.attributes.every((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name) ?? "";
    if (
      OWN_HOOK_GUARD_ATTRIBUTES.has(name) ||
      IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES.has(name) ||
      name === "ref" ||
      name === "form" ||
      (name.startsWith("on") && attribute !== event)
    )
      return false;
    return (
      name !== "type" ||
      (isNodeOfType(attribute.value, "Literal") && attribute.value.value === "submit")
    );
  });
};

export const getPublishedOwnHookAsyncHandlers = ({
  context,
  getUnsafeAwait,
}: OwnedHookHandlerPublicationInput): ReadonlySet<EsTreeNode> => {
  const handlers = new Set<EsTreeNode>();
  try {
    const program = context.scopes.rootScope.node;
    if (!context.filename || !isNodeOfType(program, "Program")) return handlers;
    const owner = { filename: path.resolve(context.filename), program, scopes: context.scopes };
    const candidates: OwnedHookHandlerCandidate[] = [];
    walkAst(program, (node) => {
      if (!isFunctionLike(node)) return;
      for (const candidate of readOwnedHookReturn(node, owner)) {
        const unsafeAwait = getUnsafeAwait(candidate.handler);
        if (unsafeAwait) candidates.push({ ...candidate, unsafeAwait });
      }
    });
    if (!candidates.length || !hasOrdinaryHookModule(owner)) return handlers;
    const root = findNearestPackageDirectory(owner.filename);
    if (!root) return handlers;
    const project = buildSourceProjectIndex({
      rootDirectory: root,
      currentFilePath: owner.filename,
      currentProgramNode: program,
      currentScopes: owner.scopes,
    });
    if (!project || project.hasOpaqueMdxConsumerSurface || hasUnindexedRuntimeSource(project))
      return handlers;
    const modules = [...project.modulesByFilePath.values()].map((module) => ({
      filename: module.filePath,
      program: module.programNode,
      scopes: module.scopes,
    }));
    if (!hasClosedValidatorEnvironment(modules)) return handlers;
    for (const consumer of modules) {
      if (!hasOrdinaryHookModule(consumer)) continue;
      walkAst(consumer.program, (node) => {
        if (
          !isNodeOfType(node, "VariableDeclarator") ||
          !isNodeOfType(node.id, "ObjectPattern") ||
          !node.init ||
          !isNodeOfType(node.parent, "VariableDeclaration") ||
          node.parent.kind !== "const"
        )
          return;
        const consumerFunction = findEnclosingFunction(node);
        if (
          !consumerFunction ||
          !isFunctionLike(consumerFunction) ||
          consumerFunction.async ||
          consumerFunction.generator ||
          !isNodeOfType(consumerFunction.body, "BlockStatement") ||
          node.parent.parent !== consumerFunction.body ||
          !getFunctionBindingSymbols(consumerFunction, consumer.scopes).some((binding) =>
            isReactComponentOrHookName(binding.name),
          )
        )
          return;
        const consumerReturns = collectFunctionReturnStatements(consumerFunction);
        if (
          consumerReturns.length !== OWN_HOOK_SINGLE_COUNT ||
          consumerFunction.body.body.at(-OWN_HOOK_SINGLE_COUNT) !==
            consumerReturns[OWN_HOOK_FIRST_INDEX]
        )
          return;
        const call = stripParenExpression(node.init);
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          !isNodeOfType(call.callee, "Identifier")
        )
          return;
        const hookSymbol = consumer.scopes.symbolFor(call.callee);
        const imported = getImportBindingForName(consumer.program, call.callee.name);
        if (
          !hookSymbol ||
          !hasReadonlyAsyncEventBinding(hookSymbol, consumer) ||
          !imported ||
          imported.isNamespace ||
          imported.exportedName === null
        )
          return;
        const resolved = resolveCrossFileFunctionExportWithFilePath(
          consumer.filename,
          imported.source,
          imported.exportedName,
          { requireCompleteReexports: true },
        );
        if (!resolved?.contexts?.length || path.resolve(resolved.filePath) !== owner.filename)
          return;
        const seen = new Set<string>();
        for (const property of node.id.properties) {
          if (
            !isNodeOfType(property, "Property") ||
            property.kind !== "init" ||
            property.method ||
            property.computed ||
            !isNodeOfType(property.value, "Identifier")
          )
            return;
          const name = getStaticPropertyKeyName(property);
          if (!name || name === "__proto__" || seen.has(name)) return;
          seen.add(name);
        }
        for (const candidate of candidates) {
          if (
            !candidate.exportNames.includes(imported.exportedName) ||
            candidate.hook.range[OWN_HOOK_FIRST_INDEX] !==
              resolved.functionNode.range[OWN_HOOK_FIRST_INDEX] ||
            candidate.hook.range[OWN_HOOK_SINGLE_COUNT] !==
              resolved.functionNode.range[OWN_HOOK_SINGLE_COUNT] ||
            !hasClosedHookProjection(candidate, call, owner, consumer, modules)
          )
            continue;
          const selected = node.id.properties.find(
            (property) =>
              isNodeOfType(property, "Property") &&
              getStaticPropertyKeyName(property) === candidate.propertyName,
          );
          if (!isNodeOfType(selected, "Property") || !isNodeOfType(selected.value, "Identifier"))
            continue;
          const symbol = consumer.scopes.symbolFor(selected.value);
          if (!symbol || !hasReadonlyAsyncEventBinding(symbol, consumer)) continue;
          const allowed = new Set<EsTreeNode>();
          let published = false;
          for (const reference of symbol.references) {
            const value = findTransparentExpressionRoot(reference.identifier);
            const container = value.parent;
            const attribute = container?.parent;
            if (
              !isNodeOfType(container, "JSXExpressionContainer") ||
              !isNodeOfType(attribute, "JSXAttribute") ||
              !OWN_HOOK_EVENT_NAMES.has(getJsxAttributeName(attribute.name) ?? "") ||
              !isNodeOfType(attribute.parent, "JSXOpeningElement")
            )
              continue;
            const opening = attribute.parent;
            if (
              !isNodeOfType(opening.name, "JSXIdentifier") ||
              opening.attributes.filter(
                (item) =>
                  isNodeOfType(item, "JSXAttribute") &&
                  getJsxAttributeName(item.name) === getJsxAttributeName(attribute.name),
              ).length !== OWN_HOOK_SINGLE_COUNT ||
              getAuthoritativeJsxAttribute(
                opening.attributes,
                getJsxAttributeName(attribute.name) ?? "",
              ) !== attribute
            )
              continue;
            const native = getJsxAttributeName(attribute.name) === "onSubmit" ? "form" : "button";
            if (
              opening.name.name !== native &&
              resolveImportedNativeControlEventProp({
                attribute,
                context: { filename: consumer.filename, scopes: consumer.scopes },
              }) !== container.expression
            )
              continue;
            let clear = true;
            let cursor: EsTreeNode | null | undefined = opening.parent;
            while (cursor && !isFunctionLike(cursor)) {
              if (
                isNodeOfType(cursor, "LogicalExpression") ||
                isNodeOfType(cursor, "ConditionalExpression")
              )
                clear = false;
              if (isNodeOfType(cursor, "JSXElement")) {
                for (const item of cursor.openingElement.attributes) {
                  if (!isNodeOfType(item, "JSXAttribute")) {
                    clear = false;
                    break;
                  }
                  const name = getJsxAttributeName(item.name) ?? "";
                  if (name.startsWith("on") && item !== attribute) clear = false;
                  if (
                    (OWN_HOOK_GUARD_ATTRIBUTES.has(name) ||
                      IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES.has(name) ||
                      name === "ref") &&
                    (!item.value ||
                      !isNodeOfType(item.value, "JSXExpressionContainer") ||
                      readStaticBoolean(item.value.expression) !== false)
                  )
                    clear = false;
                }
              }
              cursor = cursor.parent;
            }
            const element = opening.parent;
            const returned = consumerReturns[OWN_HOOK_FIRST_INDEX].argument;
            if (
              cursor !== consumerFunction ||
              !returned ||
              !isNodeOfType(element, "JSXElement") ||
              !isAstDescendant(element, returned)
            )
              continue;
            let enabled = native === "button";
            visitStaticJsxChildren(element.children, {
              onElement: (child) => {
                for (const item of child.openingElement.attributes) {
                  if (!isNodeOfType(item, "JSXAttribute")) {
                    clear = false;
                    continue;
                  }
                  const name = getJsxAttributeName(item.name) ?? "";
                  if (
                    OWN_HOOK_GUARD_ATTRIBUTES.has(name) &&
                    (!item.value ||
                      !isNodeOfType(item.value, "JSXExpressionContainer") ||
                      readStaticBoolean(item.value.expression) !== false)
                  )
                    clear = false;
                }
                let unconditional = true;
                let ancestor: EsTreeNode | null | undefined = child.parent;
                while (ancestor && ancestor !== element) {
                  if (
                    isNodeOfType(ancestor, "LogicalExpression") ||
                    isNodeOfType(ancestor, "ConditionalExpression")
                  )
                    unconditional = false;
                  ancestor = ancestor.parent;
                }
                if (
                  unconditional &&
                  ancestor === element &&
                  hasEnabledSubmitRoute(child.openingElement, consumer, modules)
                )
                  enabled = true;
              },
            });
            if (clear && enabled) {
              allowed.add(reference.identifier);
              published = true;
            }
          }
          if (
            published &&
            hasOnlyAllowedSymbolReads({
              symbol,
              allowedIdentifiers: allowed,
              program: consumer.program,
              scopes: consumer.scopes,
            })
          )
            handlers.add(candidate.handler);
        }
      });
    }
    return handlers;
  } catch {
    return new Set();
  }
};
