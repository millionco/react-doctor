import { analyzeScopes } from "../semantic/scope-analysis.js";
import { OBJECT_PROPERTY_MUTATION_METHOD_NAMES } from "../constants/mutation-methods.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectConstAliasSymbols } from "./collect-const-alias-symbols.js";
import { createStateUpdaterDocumentProjectionInspector } from "./create-state-updater-document-projection-inspector.js";
import { createStateUpdaterOwnedWriteBaseInspector } from "./create-state-updater-owned-write-base-inspector.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveReactRefSymbol } from "./react-ref-origin.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface RefTruthinessRead {
  member: EsTreeNode;
  truthy: boolean;
}

interface EntryProofProgram {
  nodes: EsTreeNode[];
  scopes: ScopeAnalysis;
  safeProviders: boolean;
}

interface ClosedBindingOptions {
  allowSeparateBindings?: boolean;
  allowMemberWrites?: boolean;
}

const DYNAMIC_CAPABILITY_NAMES = new Set([
  "eval",
  "Function",
  "Proxy",
  "Reflect",
  "require",
  "module",
  "arguments",
]);
const DYNAMIC_CAPABILITY_PROPERTIES = new Set([
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "eval",
  "Function",
  "Reflect",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "require",
  "createRequire",
  "mainModule",
  "getBuiltinModule",
  "caller",
  "arguments",
]);
const REACT_DEPENDENCY_API_NAMES = new Set([
  "useCallback",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
]);

const isNonReferenceIdentifier = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (scopes.symbolFor(node)?.bindingIdentifier === node) return true;
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) return parent.property === node && !parent.computed;
  if (isNodeOfType(parent, "Property")) {
    return parent.key === node && !parent.computed && !(parent.shorthand && parent.value === node);
  }
  if (isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) {
    return parent.key === node && !parent.computed;
  }
  return (
    isNodeOfType(parent, "ImportDeclaration") ||
    isNodeOfType(parent, "ImportSpecifier") ||
    isNodeOfType(parent, "ImportDefaultSpecifier") ||
    isNodeOfType(parent, "ImportNamespaceSpecifier") ||
    (isNodeOfType(parent, "ExportSpecifier") &&
      parent.exported === node &&
      parent.local !== node) ||
    ((isNodeOfType(parent, "LabeledStatement") ||
      isNodeOfType(parent, "BreakStatement") ||
      isNodeOfType(parent, "ContinueStatement")) &&
      parent.label === node)
  );
};

const hasRuntimeImport = (symbol: SymbolDescriptor): boolean => {
  const specifier = symbol.declarationNode;
  const declaration = specifier.parent;
  return Boolean(
    symbol.kind === "import" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type"),
  );
};

const isDirectReactCall = (call: EsTreeNode, apiName: string, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isReactApiCall(call, apiName, scopes)
  )
    return false;
  const callee = stripParenExpression(call.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  const declaration = symbol?.declarationNode.parent;
  return Boolean(
    symbol &&
    hasRuntimeImport(symbol) &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.source.value === "react",
  );
};

const isDependencyEntry = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const array = findTransparentExpressionRoot(node).parent;
  const call = array?.parent;
  return Boolean(
    isNodeOfType(array, "ArrayExpression") &&
    isNodeOfType(call, "CallExpression") &&
    call.arguments[1] === array &&
    [...REACT_DEPENDENCY_API_NAMES].some((name) => isDirectReactCall(call, name, scopes)),
  );
};

const isOrdinaryCurrentUse = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  const member = root.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== root ||
    member.optional ||
    getStaticPropertyName(member) !== "current"
  )
    return false;
  const memberRoot = findTransparentExpressionRoot(member);
  const parent = memberRoot.parent;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === memberRoot) return false;
  if (
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === memberRoot
  )
    return false;
  if (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === memberRoot) return false;
  if (!isWithinAssignmentTarget(memberRoot)) return true;
  return Boolean(
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.left === memberRoot &&
    parent.operator === "=",
  );
};

const getTruthinessRead = (node: EsTreeNode): RefTruthinessRead | null => {
  const expression = stripParenExpression(node);
  const negated = isNodeOfType(expression, "UnaryExpression") && expression.operator === "!";
  const member = negated ? stripParenExpression(expression.argument) : expression;
  return isNodeOfType(member, "MemberExpression") &&
    !member.optional &&
    getStaticPropertyName(member) === "current"
    ? { member, truthy: !negated }
    : null;
};

const getFirstRuntimeStatement = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "BlockStatement")) return null;
  return (
    node.body.find(
      (statement) =>
        !isNodeOfType(statement, "EmptyStatement") &&
        !(
          isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "Literal") &&
          typeof statement.expression.value === "string"
        ),
    ) ?? null
  );
};

export const createStateUpdaterEntryExclusionResolver = (
  context: RuleContext,
): ((call: EsTreeNode, callee: EsTreeNode) => ReadonlySet<EsTreeNode>) => {
  const programs = new WeakMap<EsTreeNode, EntryProofProgram>();
  const cellProofs = new Map<SymbolDescriptor, boolean>();
  const consumerProofs = new Map<EsTreeNode, Map<number, boolean>>();
  const empty = new Set<EsTreeNode>();

  const indexProgram = (program: EsTreeNode, scopes: ScopeAnalysis): EntryProofProgram => {
    const cached = programs.get(program);
    if (cached) return cached;
    const nodes: EsTreeNode[] = [];
    let safeProviders = true;
    walkAst(program, (node) => {
      if (
        [
          "WithStatement",
          "TSEnumDeclaration",
          "TSModuleDeclaration",
          "TSParameterProperty",
          "TSImportEqualsDeclaration",
          "TSExportAssignment",
          "ImportExpression",
        ].includes(node.type)
      ) {
        safeProviders = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (
        isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        typeof node.source.value === "string" &&
        ["module", "node:module", "vm", "node:vm", "process", "node:process"].includes(
          node.source.value,
        )
      )
        safeProviders = false;
      nodes.push(node);
      if (isNodeOfType(node, "Identifier") && !isNonReferenceIdentifier(node, scopes)) {
        if (DYNAMIC_CAPABILITY_NAMES.has(node.name)) safeProviders = false;
        const symbol = scopes.symbolFor(node);
        if (symbol) {
          let owner = node.parent;
          while (owner) {
            if (
              isFunctionLike(owner) &&
              owner.params.some((parameter) => isAstDescendant(node, parameter)) &&
              owner.body &&
              isAstDescendant(symbol.declarationNode, owner.body)
            )
              safeProviders = false;
            owner = owner.parent;
          }
        }
        if (
          ["process", "parent", "top", "frames"].includes(node.name) &&
          (!symbol || !hasRuntimeValueBinding(symbol))
        )
          safeProviders = false;
        if (
          ["globalThis", "global", "self", "window"].includes(node.name) &&
          symbol &&
          !hasRuntimeValueBinding(symbol)
        )
          safeProviders = false;
        if (isProvenGlobalObjectReference(node, scopes)) {
          const root = findTransparentExpressionRoot(node);
          const parent = root.parent;
          const propertyName =
            isNodeOfType(parent, "MemberExpression") && parent.object === root
              ? getResolvedStaticPropertyName(parent, scopes)
              : null;
          if (
            propertyName === null ||
            [
              "process",
              "globalThis",
              "global",
              "self",
              "window",
              "parent",
              "top",
              "frames",
              "document",
              "Object",
            ].includes(propertyName)
          )
            safeProviders = false;
        }
        if (node.name === "Object" && (!symbol || !hasRuntimeValueBinding(symbol))) {
          const root = findTransparentExpressionRoot(node);
          const member = root.parent;
          const propertyName = isNodeOfType(member, "MemberExpression")
            ? getResolvedStaticPropertyName(member, scopes)
            : null;
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== root ||
            member.optional ||
            propertyName === null ||
            OBJECT_PROPERTY_MUTATION_METHOD_NAMES.has(propertyName) ||
            !isNodeOfType(member.parent, "CallExpression") ||
            member.parent.callee !== member
          )
            safeProviders = false;
        }
        if (node.name === "React") {
          const declaration = symbol?.declarationNode.parent;
          if (
            !symbol ||
            !hasRuntimeImport(symbol) ||
            !isNodeOfType(declaration, "ImportDeclaration") ||
            declaration.source.value !== "react"
          )
            safeProviders = false;
        }
      }
      if (isNodeOfType(node, "MemberExpression")) {
        const propertyName = getResolvedStaticPropertyName(node, scopes);
        if (DYNAMIC_CAPABILITY_PROPERTIES.has(propertyName ?? "") || propertyName === "React")
          safeProviders = false;
      }
      if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
        const key = getStaticPropertyKeyName(node, { allowComputedString: true });
        if (key === null || DYNAMIC_CAPABILITY_PROPERTIES.has(key)) safeProviders = false;
      }
    });
    const indexed = { nodes, scopes, safeProviders };
    const hasOwnedWriteBase = createStateUpdaterOwnedWriteBaseInspector({
      scopes,
      hasClosedBinding: (symbols) =>
        hasClosedBinding(symbols, indexed, { allowMemberWrites: true }),
      isNativeRefCall: (call) => isDirectReactCall(call, "useRef", scopes),
      isDependencyEntry: (node) => isDependencyEntry(node, scopes),
    });
    const hasSafeDocumentUse = createStateUpdaterDocumentProjectionInspector({
      scopes,
      hasClosedBinding: (symbols) =>
        hasClosedBinding(symbols, indexed, { allowSeparateBindings: true }),
      hasClosedFunctionBinding: (symbols) => hasClosedBinding(symbols, indexed),
    });
    for (const node of nodes) {
      if (isNodeOfType(node, "MemberExpression")) {
        const propertyName = getResolvedStaticPropertyName(node, scopes);
        if (
          isWithinAssignmentTarget(findTransparentExpressionRoot(node)) &&
          (propertyName === null ||
            REACT_DEPENDENCY_API_NAMES.has(propertyName) ||
            ["useRef", "useState", "useReducer", "createElement"].includes(propertyName)) &&
          !hasOwnedWriteBase(node.object)
        )
          safeProviders = false;
      }
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "document" &&
        !isNonReferenceIdentifier(node, scopes)
      ) {
        const symbol = scopes.symbolFor(node);
        if ((!symbol || !hasRuntimeValueBinding(symbol)) && !hasSafeDocumentUse(node))
          safeProviders = false;
      }
    }
    const reactImports = scopes.rootScope.symbols.filter((symbol) => {
      const declaration = symbol.declarationNode.parent;
      return (
        hasRuntimeImport(symbol) &&
        isNodeOfType(declaration, "ImportDeclaration") &&
        declaration.source.value === "react"
      );
    });
    for (const symbol of reactImports) {
      for (const node of nodes) {
        if (
          !isNodeOfType(node, "Identifier") ||
          node.name !== symbol.name ||
          isNonReferenceIdentifier(node, scopes)
        )
          continue;
        const reference = scopes.referenceFor(node);
        if (!reference) {
          safeProviders = false;
          continue;
        }
        if (reference.resolvedSymbol !== symbol) {
          safeProviders = false;
          continue;
        }
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        if (reference.flag !== "read" || isWithinAssignmentTarget(root)) {
          safeProviders = false;
          continue;
        }
        if (
          isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
          getImportedName(symbol.declarationNode) !== "default"
        )
          continue;
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          parent.optional ||
          !isNodeOfType(parent.parent, "CallExpression") ||
          parent.parent.callee !== parent ||
          (!REACT_DEPENDENCY_API_NAMES.has(getStaticPropertyName(parent) ?? "") &&
            !["useRef", "useState", "useReducer", "createElement"].includes(
              getStaticPropertyName(parent) ?? "",
            ))
        )
          safeProviders = false;
      }
    }
    indexed.safeProviders = safeProviders;
    programs.set(program, indexed);
    return indexed;
  };

  const hasClosedBinding = (
    symbols: SymbolDescriptor[],
    indexed: EntryProofProgram,
    options: ClosedBindingOptions = {},
  ): boolean => {
    if (
      symbols.length === 0 ||
      symbols.some((symbol) => symbol.references.some((reference) => reference.flag !== "read"))
    )
      return false;
    const bindingSymbolSet = new Set(symbols);
    for (const node of indexed.nodes) {
      if (
        !isNodeOfType(node, "Identifier") ||
        !symbols.some((symbol) => symbol.name === node.name) ||
        isNonReferenceIdentifier(node, indexed.scopes)
      )
        continue;
      const reference = indexed.scopes.referenceFor(node);
      if (!reference) return false;
      if (reference.resolvedSymbol && !bindingSymbolSet.has(reference.resolvedSymbol)) {
        if (options.allowSeparateBindings) continue;
        return false;
      }
      if (!reference.resolvedSymbol || reference.flag !== "read") return false;
      const root = findTransparentExpressionRoot(node);
      if (
        isWithinAssignmentTarget(root) &&
        !(
          options.allowMemberWrites &&
          isNodeOfType(root.parent, "MemberExpression") &&
          root.parent.object === root
        )
      )
        return false;
    }
    return true;
  };

  const hasClosedConsumer = (call: EsTreeNode, argument: EsTreeNode): boolean => {
    if (
      !context.filename ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      !isNodeOfType(call.callee, "Identifier") ||
      call.arguments.some((value) => isNodeOfType(value, "SpreadElement"))
    )
      return false;
    const imported = context.scopes.symbolFor(call.callee);
    const declaration = imported?.declarationNode.parent;
    if (
      !imported ||
      !hasRuntimeImport(imported) ||
      !isNodeOfType(declaration, "ImportDeclaration") ||
      typeof declaration.source.value !== "string" ||
      !declaration.source.value.startsWith(".")
    )
      return false;
    const exportedName =
      getImportedName(imported.declarationNode) ??
      (isNodeOfType(imported.declarationNode, "ImportDefaultSpecifier") ? "default" : null);
    if (!exportedName) return false;
    const caller = indexProgram(context.scopes.rootScope.node, context.scopes);
    if (!hasClosedBinding([imported], caller)) return false;
    const resolved = resolveCrossFileFunctionExportWithFilePath(
      context.filename,
      declaration.source.value,
      exportedName,
    );
    if (
      !resolved ||
      !isFunctionLike(resolved.functionNode) ||
      resolved.functionNode.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
    )
      return false;
    const parameterIndex = call.arguments.findIndex((value) => value === argument);
    const parameter = resolved.functionNode.params[parameterIndex];
    if (!isNodeOfType(parameter, "Identifier")) return false;
    const cached = consumerProofs.get(resolved.functionNode)?.get(parameterIndex);
    if (cached !== undefined) return cached;
    const scopes =
      programs.get(resolved.programNode)?.scopes ?? analyzeScopes(resolved.programNode);
    const indexed = indexProgram(resolved.programNode, scopes);
    const selected = scopes.symbolFor(parameter);
    const bindings = getFunctionBindingSymbols(resolved.functionNode, scopes);
    const self =
      scopes
        .ownScopeFor(resolved.functionNode)
        ?.symbols.filter((symbol) => symbol.initializer === resolved.functionNode) ?? [];
    let closed = Boolean(
      selected && indexed.safeProviders && hasClosedBinding([...bindings, ...self], indexed),
    );
    for (const node of indexed.nodes) {
      if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node, scopes)) continue;
      if (node.name === "arguments") closed = false;
      if (node.name !== parameter.name) continue;
      const reference = scopes.referenceFor(node);
      if (!reference) {
        closed = false;
        continue;
      }
      if (reference.resolvedSymbol !== selected) {
        closed = false;
        continue;
      }
      if (
        reference.flag !== "read" ||
        !(isOrdinaryCurrentUse(node) || isDependencyEntry(node, scopes))
      )
        closed = false;
    }
    const byParameter = consumerProofs.get(resolved.functionNode) ?? new Map<number, boolean>();
    byParameter.set(parameterIndex, closed);
    consumerProofs.set(resolved.functionNode, byParameter);
    return closed;
  };

  const hasOrdinaryCell = (symbol: SymbolDescriptor): boolean => {
    const cached = cellProofs.get(symbol);
    if (cached !== undefined) return cached;
    const indexed = indexProgram(context.scopes.rootScope.node, context.scopes);
    const aliases = collectConstAliasSymbols(symbol, context.scopes);
    const aliasSymbolSet = new Set(aliases);
    let closed =
      indexed.safeProviders &&
      symbol.kind === "const" &&
      Boolean(
        symbol.initializer &&
        isDirectReactCall(stripParenExpression(symbol.initializer), "useRef", context.scopes),
      );
    for (const node of indexed.nodes) {
      if (
        !isNodeOfType(node, "Identifier") ||
        !aliases.some((alias) => alias.name === node.name) ||
        isNonReferenceIdentifier(node, context.scopes)
      )
        continue;
      const reference = context.scopes.referenceFor(node);
      if (!reference) {
        closed = false;
        continue;
      }
      if (!reference.resolvedSymbol) {
        closed = false;
        continue;
      }
      if (!aliasSymbolSet.has(reference.resolvedSymbol)) {
        closed = false;
        continue;
      }
      if (reference.flag !== "read") {
        closed = false;
        continue;
      }
      if (isOrdinaryCurrentUse(node) || isDependencyEntry(node, context.scopes)) continue;
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier") &&
        aliases.some((alias) => alias === context.scopes.symbolFor(parent.id))
      )
        continue;
      if (
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.some((argument) => argument === root) &&
        hasClosedConsumer(parent, root)
      )
        continue;
      closed = false;
    }
    cellProofs.set(symbol, closed);
    return closed;
  };

  return (call, callee) => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== 0 ||
      !isNodeOfType(call.callee, "Identifier") ||
      !isFunctionLike(callee) ||
      callee.async ||
      ("generator" in callee && callee.generator) ||
      callee.params.length !== 0
    )
      return empty;
    const statement = call.parent;
    if (!isNodeOfType(statement, "ExpressionStatement") || statement.expression !== call)
      return empty;
    const block = statement.parent;
    const callerIf = isNodeOfType(block, "BlockStatement") ? block.parent : block;
    if (
      !isNodeOfType(callerIf, "IfStatement") ||
      !(
        callerIf.consequent === statement ||
        (callerIf.consequent === block && getFirstRuntimeStatement(block) === statement)
      )
    )
      return empty;
    let callerTest = stripParenExpression(callerIf.test);
    while (isNodeOfType(callerTest, "LogicalExpression") && callerTest.operator === "&&")
      callerTest = stripParenExpression(callerTest.right);
    const callerRead = getTruthinessRead(callerTest);
    let initial = callee.body ? getFirstRuntimeStatement(callee.body) : null;
    if (isNodeOfType(initial, "TryStatement")) initial = getFirstRuntimeStatement(initial.block);
    if (!callerRead || !isNodeOfType(initial, "IfStatement")) return empty;
    const exclusions = new Set<EsTreeNode>([initial.consequent]);
    let calleeTest = stripParenExpression(initial.test);
    while (isNodeOfType(calleeTest, "LogicalExpression") && calleeTest.operator === "&&") {
      exclusions.add(calleeTest.right);
      calleeTest = stripParenExpression(calleeTest.left);
    }
    const calleeRead = getTruthinessRead(calleeTest);
    if (!calleeRead || callerRead.truthy === calleeRead.truthy) return empty;
    const callerSymbol = resolveReactRefSymbol(callerRead.member, context.scopes);
    const calleeSymbol = resolveReactRefSymbol(calleeRead.member, context.scopes);
    if (!callerSymbol || callerSymbol !== calleeSymbol || !hasOrdinaryCell(callerSymbol))
      return empty;
    const indexed = indexProgram(context.scopes.rootScope.node, context.scopes);
    const calledSymbol = resolveConstIdentifierAlias(call.callee, context.scopes);
    if (!calledSymbol || !["const", "function"].includes(calledSymbol.kind)) return empty;
    const selfBindings =
      context.scopes
        .ownScopeFor(callee)
        ?.symbols.filter((symbol) => symbol.initializer === callee) ?? [];
    const bindings = [
      ...collectConstAliasSymbols(calledSymbol, context.scopes),
      ...getFunctionBindingSymbols(callee, context.scopes),
      ...selfBindings,
    ];
    if (!hasClosedBinding(bindings, indexed)) return empty;
    const initializer = calledSymbol.initializer
      ? stripParenExpression(calledSymbol.initializer)
      : null;
    if (
      initializer !== callee &&
      !(
        initializer &&
        isDirectReactCall(initializer, "useCallback", context.scopes) &&
        isNodeOfType(initializer, "CallExpression") &&
        initializer.arguments[0] &&
        stripParenExpression(initializer.arguments[0]) === callee
      )
    )
      return empty;
    return exclusions;
  };
};
