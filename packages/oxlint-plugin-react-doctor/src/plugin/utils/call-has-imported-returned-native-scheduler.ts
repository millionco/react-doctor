import {
  GLOBAL_OBJECT_NAMES,
  DYNAMIC_CODE_NAMES,
  PROVIDER_CAPABILITY_NAMES,
  TIMER_NAMES,
  RUNTIME_PROVIDER_NODES,
  SCHEDULER_PROVIDER_NAMES,
} from "./returned-scheduler/constants.js";
import { isNativeProviderReference } from "./returned-scheduler/is-native-provider-reference.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isResultDiscardedCall } from "./is-result-discarded-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface SchedulerProgramFacts {
  readonly scopes: ScopeAnalysis;
  readonly providersClosed: boolean;
  readonly factories: WeakMap<EsTreeNode, boolean>;
}

const factsByProgram = new WeakMap<EsTreeNode, SchedulerProgramFacts>();

const isStaticNamePosition = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    (isNodeOfType(parent, "MemberExpression") && parent.property === node && !parent.computed) ||
    (isNodeOfType(parent, "Property") &&
      parent.key === node &&
      !parent.computed &&
      (!parent.shorthand || parent.value !== node)) ||
    ((isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
      parent.key === node &&
      !parent.computed) ||
    (isNodeOfType(parent, "ImportSpecifier") &&
      parent.imported === node &&
      parent.local !== node) ||
    (isNodeOfType(parent, "ExportSpecifier") &&
      parent.exported === node &&
      parent.local !== node) ||
    ((isNodeOfType(parent, "LabeledStatement") ||
      isNodeOfType(parent, "BreakStatement") ||
      isNodeOfType(parent, "ContinueStatement")) &&
      parent.label === node),
  );
};

const isRuntimeReactCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  const call = stripParenExpression(node);
  if (!isNodeOfType(call, "CallExpression") || call.optional || !isReactApiCall(call, name, scopes))
    return false;
  const callee = stripParenExpression(call.callee);
  const root = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (
    !isNodeOfType(root, "Identifier") ||
    (isNodeOfType(callee, "MemberExpression") && callee.optional)
  )
    return false;
  const symbol = scopes.symbolFor(root);
  if (!symbol || symbol.kind !== "import") return false;
  const imported = resolveImportedApiReference(callee, scopes);
  return imported?.source === "react" && imported.importedName === name;
};

const getProgramFacts = (
  program: EsTreeNode,
  suppliedScopes?: ScopeAnalysis,
): SchedulerProgramFacts => {
  const cached = factsByProgram.get(program);
  if (cached) return cached;
  const scopes = suppliedScopes ?? analyzeScopes(program);
  const reactBindingNames = new Set(
    scopes.rootScope.symbols
      .filter((symbol) => getImportDeclarationForSymbol(symbol)?.source.value === "react")
      .map((symbol) => symbol.name),
  );
  let providersClosed = true;
  walkAst(program, (node) => {
    if (!providersClosed) return false;
    if (RUNTIME_PROVIDER_NODES.has(node.type)) {
      providersClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ObjectPattern") &&
      node.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          (property.computed ||
            PROVIDER_CAPABILITY_NAMES.has(getStaticPropertyKeyName(property) ?? "")),
      )
    ) {
      providersClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      PROVIDER_CAPABILITY_NAMES.has(getStaticPropertyName(node) ?? "")
    ) {
      providersClosed = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isStaticNamePosition(node)) return;
    const symbol = scopes.symbolFor(node);
    if (symbol?.bindingIdentifier === node) return;
    const reference = scopes.referenceFor(node);
    if (DYNAMIC_CODE_NAMES.has(node.name) || node.name === "Reflect") {
      providersClosed = false;
      return false;
    }
    if (!reference) {
      if (
        GLOBAL_OBJECT_NAMES.has(node.name) ||
        TIMER_NAMES.has(node.name) ||
        reactBindingNames.has(node.name)
      )
        providersClosed = false;
      return;
    }
    if (
      TIMER_NAMES.has(node.name) &&
      isNativeProviderReference(node, scopes) &&
      reference.flag !== "read"
    ) {
      providersClosed = false;
      return false;
    }
    if (SCHEDULER_PROVIDER_NAMES.has(node.name) && !isNativeProviderReference(node, scopes)) {
      providersClosed = false;
      return false;
    }
    const reactDeclaration = symbol && getImportDeclarationForSymbol(symbol);
    const isReactImport = reactDeclaration?.source.value === "react";
    if (
      !isReactImport &&
      !(GLOBAL_OBJECT_NAMES.has(node.name) && isNativeProviderReference(node, scopes))
    )
      return;
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    const member =
      isNodeOfType(parent, "MemberExpression") && parent.object === root ? parent : null;
    const call = member ? findTransparentExpressionRoot(member).parent : parent;
    const directNamedReact =
      isReactImport && isNodeOfType(symbol?.declarationNode, "ImportSpecifier");
    providersClosed = Boolean(
      reference.flag === "read" &&
      (!isReactImport ||
        (reactDeclaration?.importKind !== "type" &&
          (!isNodeOfType(symbol?.declarationNode, "ImportSpecifier") ||
            symbol.declarationNode.importKind !== "type"))) &&
      (directNamedReact ||
        (member && !member.optional && getStaticPropertyName(member) !== null)) &&
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      (member ? call.callee === findTransparentExpressionRoot(member) : call.callee === root),
    );
  });
  const facts = { scopes, providersClosed, factories: new WeakMap<EsTreeNode, boolean>() };
  factsByProgram.set(program, facts);
  return facts;
};

const hasClosedBindings = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  bindings: ReadonlyArray<SymbolDescriptor>,
  allowsRead: (identifier: EsTreeNode, symbol: SymbolDescriptor) => boolean = () => true,
): boolean => {
  if (bindings.some((symbol) => symbol.references.some((reference) => reference.flag !== "read")))
    return false;
  const selected = new Map(bindings.map((symbol) => [symbol.id, symbol]));
  const names = new Set(bindings.map((symbol) => symbol.name));
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      isStaticNamePosition(node) ||
      bindings.some((symbol) => symbol.bindingIdentifier === node)
    )
      return;
    const reference = scopes.referenceFor(node);
    if (!reference) {
      if (names.has(node.name)) closed = false;
      return;
    }
    const symbol = reference.resolvedSymbol && selected.get(reference.resolvedSymbol.id);
    if (symbol && !allowsRead(node, symbol)) closed = false;
  });
  return closed;
};

const getOrderedConst = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    !getDirectConstInitializer(symbol) ||
    symbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        reference.identifier.range[0] < symbol.declarationNode.range[1],
    )
  )
    return null;
  return symbol;
};

const isNativeTimerCall = (
  node: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> => {
  const call = stripParenExpression(node);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const member = stripParenExpression(call.callee);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    getStaticPropertyName(member) !== name
  )
    return false;
  const receiver = stripParenExpression(member.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    isNativeProviderReference(receiver, scopes)
  );
};

const getRefRead = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"Identifier"> | null => {
  const member = stripParenExpression(node);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    getStaticPropertyName(member) !== "current"
  )
    return null;
  const receiver = stripParenExpression(member.object);
  return isNodeOfType(receiver, "Identifier") && scopes.symbolFor(receiver) ? receiver : null;
};

const isDependencyRead = (node: EsTreeNode, call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const root = findTransparentExpressionRoot(node);
  return isNodeOfType(root.parent, "ArrayExpression") && root.parent === call.arguments[1];
};

const factoryReturnsNativeScheduler = (
  factory: EsTreeNode,
  program: EsTreeNode,
  facts: SchedulerProgramFacts,
): boolean => {
  const cached = facts.factories.get(factory);
  if (cached !== undefined) return cached;
  const certify = (): boolean => {
    const scopes = facts.scopes;
    if (
      !facts.providersClosed ||
      !isNodeOfType(factory, "FunctionDeclaration") ||
      factory.async ||
      factory.generator ||
      !factory.id ||
      !isNodeOfType(factory.parent, "ExportNamedDeclaration") ||
      factory.parent.exportKind === "type" ||
      factory.parent.declaration !== factory ||
      !isNodeOfType(factory.body, "BlockStatement")
    )
      return false;
    const functionBindings = [
      ...getFunctionBindingSymbols(factory, scopes),
      ...(scopes
        .ownScopeFor(factory)
        ?.symbols.filter(
          (symbol) => symbol.bindingIdentifier === factory.id && symbol.declarationNode === factory,
        ) ?? []),
    ];
    if (functionBindings.length === 0 || !hasClosedBindings(program, scopes, functionBindings))
      return false;
    const parameters: SymbolDescriptor[] = [];
    for (const parameter of factory.params) {
      if (!isNodeOfType(parameter, "Identifier")) return false;
      const symbol = scopes.symbolFor(parameter);
      if (!symbol) return false;
      parameters.push(symbol);
    }
    if (!hasClosedBindings(program, scopes, parameters)) return false;
    const statements = factory.body.body;
    const returned = statements.at(-1);
    if (!isNodeOfType(returned, "ReturnStatement") || !returned.argument) return false;
    const result = getOrderedConst(stripParenExpression(returned.argument), scopes);
    const initializer = result?.initializer && stripParenExpression(result.initializer);
    if (
      !result ||
      result.declarationNode.parent?.parent !== factory.body ||
      !initializer ||
      !isNodeOfType(initializer, "CallExpression") ||
      !isRuntimeReactCall(initializer, "useCallback", scopes)
    )
      return false;
    if (
      initializer.arguments.length !== 2 ||
      !isNodeOfType(initializer.arguments[1], "ArrayExpression")
    )
      return false;
    const callback = initializer.arguments[0] && stripParenExpression(initializer.arguments[0]);
    if (
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      callback.async ||
      callback.generator ||
      !isNodeOfType(callback.body, "BlockStatement")
    )
      return false;
    if (
      callback.params.some(
        (parameter) =>
          !isNodeOfType(parameter, "Identifier") &&
          !(
            isNodeOfType(parameter, "RestElement") && isNodeOfType(parameter.argument, "Identifier")
          ),
      )
    )
      return false;
    const [clearStatement, scheduleStatement, ...otherStatements] = callback.body.body;
    if (
      !isNodeOfType(clearStatement, "ExpressionStatement") ||
      !isNodeOfType(scheduleStatement, "ExpressionStatement") ||
      otherStatements.length !== 0
    )
      return false;
    const clearCall = stripParenExpression(clearStatement.expression);
    const assignment = stripParenExpression(scheduleStatement.expression);
    if (
      !isNativeTimerCall(clearCall, "clearTimeout", scopes) ||
      clearCall.arguments.length !== 1 ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "="
    )
      return false;
    const clearRef = getRefRead(clearCall.arguments[0], scopes);
    const writtenRef = getRefRead(assignment.left, scopes);
    const schedule = stripParenExpression(assignment.right);
    if (
      !clearRef ||
      !writtenRef ||
      scopes.symbolFor(clearRef)?.id !== scopes.symbolFor(writtenRef)?.id ||
      !isNativeTimerCall(schedule, "setTimeout", scopes) ||
      schedule.arguments.length !== 2
    )
      return false;
    const deferred = stripParenExpression(schedule.arguments[0]);
    const delay = stripParenExpression(schedule.arguments[1]);
    if (
      !isNodeOfType(deferred, "ArrowFunctionExpression") ||
      deferred.async ||
      deferred.generator ||
      (!(isNodeOfType(delay, "Literal") && typeof delay.value === "number") &&
        !(
          isNodeOfType(delay, "Identifier") &&
          parameters.some((symbol) => symbol.id === scopes.symbolFor(delay)?.id)
        ))
    )
      return false;
    const ref = getOrderedConst(clearRef, scopes);
    const refInitializer = ref?.initializer && stripParenExpression(ref.initializer);
    if (
      !ref ||
      ref.declarationNode.parent?.parent !== factory.body ||
      !refInitializer ||
      !isNodeOfType(refInitializer, "CallExpression") ||
      !isRuntimeReactCall(refInitializer, "useRef", scopes) ||
      refInitializer.arguments.length !== 1 ||
      !isNodeOfType(refInitializer.arguments[0], "Literal") ||
      refInitializer.arguments[0].value !== 0
    )
      return false;
    const allowedRefReads = new Set<EsTreeNode>([clearRef, writtenRef]);
    for (const statement of statements.slice(0, -1)) {
      if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
        for (const declaration of statement.declarations) {
          if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
          const binding = getOrderedConst(declaration.id, scopes);
          if (!binding) return false;
          if (binding.id === result.id || binding.id === ref.id) continue;
          if (
            !hasClosedBindings(
              program,
              scopes,
              [binding],
              (identifier) =>
                isAstDescendant(identifier, deferred) || isDependencyRead(identifier, initializer),
            )
          )
            return false;
        }
        continue;
      }
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      const effect = stripParenExpression(statement.expression);
      if (
        !isNodeOfType(effect, "CallExpression") ||
        !isRuntimeReactCall(effect, "useEffect", scopes) ||
        effect.arguments.length !== 2 ||
        !isNodeOfType(effect.arguments[1], "ArrayExpression") ||
        effect.arguments[1].elements.length !== 0
      )
        return false;
      const effectCallback = stripParenExpression(effect.arguments[0]);
      const cleanup =
        isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
        stripParenExpression(effectCallback.body);
      if (
        !isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
        effectCallback.async ||
        effectCallback.params.length !== 0 ||
        !cleanup ||
        !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
        cleanup.async ||
        cleanup.params.length !== 0
      )
        return false;
      const cleanupCall = stripParenExpression(cleanup.body);
      if (
        !isNativeTimerCall(cleanupCall, "clearTimeout", scopes) ||
        cleanupCall.arguments.length !== 1
      )
        return false;
      const cleanupRef = getRefRead(cleanupCall.arguments[0], scopes);
      if (!cleanupRef || scopes.symbolFor(cleanupRef)?.id !== ref.id) return false;
      allowedRefReads.add(cleanupRef);
    }
    return (
      hasClosedBindings(program, scopes, [ref], (identifier) => allowedRefReads.has(identifier)) &&
      hasClosedBindings(
        program,
        scopes,
        [result],
        (identifier) => findTransparentExpressionRoot(identifier).parent === returned,
      )
    );
  };
  const result = certify();
  facts.factories.set(factory, result);
  return result;
};

export const callHasImportedReturnedNativeScheduler = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  try {
    if (!context.filename || call.optional || !isResultDiscardedCall(call)) return false;
    const callee = stripParenExpression(call.callee);
    const callerProgram = findProgramRoot(call);
    if (!callerProgram || !isNodeOfType(callee, "Identifier")) return false;
    const callerFacts = getProgramFacts(callerProgram, context.scopes);
    const result = getOrderedConst(callee, callerFacts.scopes);
    const initialized = result?.initializer && stripParenExpression(result.initializer);
    if (
      !callerFacts.providersClosed ||
      !result ||
      !isNodeOfType(initialized, "CallExpression") ||
      initialized.optional
    )
      return false;
    const factoryIdentifier = stripParenExpression(initialized.callee);
    if (!isNodeOfType(factoryIdentifier, "Identifier")) return false;
    const importedSymbol = callerFacts.scopes.symbolFor(factoryIdentifier);
    if (
      !importedSymbol ||
      importedSymbol.kind !== "import" ||
      !isNodeOfType(importedSymbol.declarationNode, "ImportSpecifier") ||
      !hasClosedBindings(callerProgram, callerFacts.scopes, [result, importedSymbol])
    )
      return false;
    const imported = resolveImportedApiReference(factoryIdentifier, callerFacts.scopes);
    if (
      !imported ||
      !imported.importedName ||
      imported.importedName === "default" ||
      imported.isNamespace
    )
      return false;
    const resolved = resolveCrossFileFunctionExportWithFilePath(
      context.filename,
      imported.source,
      imported.importedName,
    );
    if (!resolved || resolved.filePath !== resolveModulePath(context.filename, imported.source))
      return false;
    const foreignFacts = getProgramFacts(resolved.programNode);
    return factoryReturnsNativeScheduler(resolved.functionNode, resolved.programNode, foreignFacts);
  } catch {
    return false;
  }
};
