import type { RuleContext } from "./rule-context.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "./find-render-phase-component-or-hook.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const DEPENDENCY_HOOKS = new Set([
  "useCallback",
  "useMemo",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);
const STOCK_ORDERED_HOOKS = new Set([
  "useCallback",
  "useMemo",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useId",
  "useRef",
  "useState",
  "useReducer",
  "useContext",
  "useDebugValue",
  "useImperativeHandle",
  "useSyncExternalStore",
  "useDeferredValue",
  "useTransition",
  "useActionState",
  "useOptimistic",
  "useEffectEvent",
  "useFormState",
]);
const READONLY_REACT_APIS = new Set([
  ...STOCK_ORDERED_HOOKS,
  "memo",
  "forwardRef",
  "createRef",
  "createElement",
]);
const MOCK_LOADER_METHODS = new Set(["mock", "doMock", "unstable_mockModule"]);
const DYNAMIC_EXECUTION_NAMES = new Set(["eval", "Function", "require"]);
const DYNAMIC_CAPABILITY_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "require",
  "createRequire",
]);
const closedReactByScopes = new WeakMap<ScopeAnalysis, boolean>();

const runtimeReactImport = (
  symbol: SymbolDescriptor | null,
): EsTreeNodeOfType<"ImportDeclaration"> | null => {
  const declaration = symbol?.declarationNode.parent;
  return symbol?.kind === "import" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "react" &&
    !(
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type"
    )
    ? declaration
    : null;
};

const isDirectReactCall = (
  node: EsTreeNode,
  names: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isReactApiCall(node, names, scopes)
  )
    return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = scopes.symbolFor(callee);
    return Boolean(
      runtimeReactImport(symbol) &&
      symbol &&
      isNodeOfType(symbol.declarationNode, "ImportSpecifier"),
    );
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.object, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(callee.object);
  return Boolean(
    runtimeReactImport(symbol) &&
    symbol &&
    (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")),
  );
};

// This proof relies on stock React and ordinary JavaScript built-ins. The
// React wrapper must retain its ordinary runtime identity. Do not infer it
// from a spelling, type-only import, const alias, or a visibly exposed namespace.
const hasClosedReactAndLexicalExecution = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = closedReactByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(program, (node) => {
    if (!closed || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "ExportAllDeclaration") &&
        node.exportKind !== "type" &&
        node.source.value === "react") ||
      (isNodeOfType(node, "ExportNamedDeclaration") &&
        node.exportKind !== "type" &&
        node.source?.value === "react") ||
      (isNodeOfType(node, "Identifier") &&
        DYNAMIC_EXECUTION_NAMES.has(node.name) &&
        scopes.isGlobalReference(node))
    ) {
      closed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      DYNAMIC_CAPABILITY_PROPERTIES.has(getResolvedStaticPropertyName(node, scopes) ?? "")
    ) {
      closed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      getResolvedStaticPropertyName(node, scopes) === "is" &&
      isWithinAssignmentTarget(node)
    ) {
      closed = false;
      return false;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      const name = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "MemberExpression")
          ? getResolvedStaticPropertyName(callee, scopes)
          : null;
      if (name && MOCK_LOADER_METHODS.has(name)) {
        closed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration") || node.importKind === "type") return;
    const source = node.source.value;
    if (
      source === "module" ||
      source === "node:module" ||
      (typeof source === "string" &&
        (source.startsWith("react/") || /(?:^|\/)node_modules\/react(?:\/|$)/.test(source)))
    ) {
      closed = false;
      return false;
    }
    if (source !== "react") return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (
        !symbol ||
        !isSymbolReadOnly(symbol) ||
        symbol.references.some((reference) => isWithinAssignmentTarget(reference.identifier)) ||
        !hasCompleteSymbolReferences(symbol, program, scopes)
      ) {
        closed = false;
        return false;
      }
      for (const reference of symbol.references) {
        if (isKeyedDraftTypeReference(reference.identifier)) continue;
        const root = findTransparentExpressionRoot(reference.identifier);
        let actualCallee = root;
        if (isNodeOfType(root.parent, "MemberExpression") && root.parent.object === root)
          actualCallee = findTransparentExpressionRoot(root.parent);
        const call = actualCallee.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== actualCallee ||
          !isDirectReactCall(call, READONLY_REACT_APIS, scopes)
        ) {
          closed = false;
          return false;
        }
      }
    }
  });
  closedReactByScopes.set(scopes, closed);
  return closed;
};

const isLiteralDependencyArray = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "ArrayExpression") &&
  node.elements.every((element) => element !== null && !isNodeOfType(element, "SpreadElement"));

const isDependencyRead = (reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const root = findTransparentExpressionRoot(reference);
  const array = root.parent;
  const hook = array?.parent;
  return (
    isNodeOfType(array, "ArrayExpression") &&
    isLiteralDependencyArray(array) &&
    array.elements.some((element) => element === root) &&
    isNodeOfType(hook, "CallExpression") &&
    hook.arguments.length === 2 &&
    hook.arguments[1] === array &&
    !hook.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) &&
    isDirectReactCall(hook, DEPENDENCY_HOOKS, scopes)
  );
};

const hasStableHookOrder = (hook: EsTreeNode, context: RuleContext): boolean => {
  const owner = findEnclosingFunction(hook);
  if (
    !owner ||
    findRenderPhaseComponentOrHook(hook, context.scopes) !== owner ||
    !context.cfg.isUnconditionalFromEntry(hook)
  )
    return false;

  // An earlier conditional hook can occupy this memo slot on another render.
  // Calls after a fixed, unconditional slot cannot take its place.
  let stable = true;
  walkAst(owner, (node) => {
    if (!stable || node.range[0] > hook.range[0] || (node !== owner && isFunctionLike(node)))
      return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    const name = isNodeOfType(callee, "Identifier")
      ? callee.name
      : isNodeOfType(callee, "MemberExpression")
        ? getResolvedStaticPropertyName(callee, context.scopes)
        : null;
    if (!isDirectReactCall(node, STOCK_ORDERED_HOOKS, context.scopes)) {
      if (name && /^use[A-Z0-9]/.test(name)) stable = false;
      return;
    }
    const parent = node.parent;
    const statement =
      isNodeOfType(parent, "VariableDeclarator") && parent.init === node ? parent.parent : parent;
    if (
      (!isNodeOfType(statement, "VariableDeclaration") &&
        !(isNodeOfType(statement, "ExpressionStatement") && statement.expression === node)) ||
      !isNodeOfType(statement.parent, "BlockStatement") ||
      statement.parent.parent !== owner ||
      !context.cfg.isUnconditionalFromEntry(node)
    )
      stable = false;
  });
  return stable;
};

const getClosedBooleanArgument = (
  condition: EsTreeNode,
  context: RuleContext,
  program: EsTreeNode,
): boolean | null => {
  if (!isNodeOfType(condition, "Identifier")) return null;
  const { scopes } = context;
  const parameter = scopes.symbolFor(condition);
  if (
    parameter?.kind !== "parameter" ||
    !isSymbolReadOnly(parameter) ||
    parameter.references.some((reference) => isWithinAssignmentTarget(reference.identifier))
  )
    return null;

  const callback = findEnclosingFunction(parameter.bindingIdentifier);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return null;

  const isBooleanFormal = (formal: EsTreeNode): boolean =>
    formal === parameter.bindingIdentifier ||
    (isNodeOfType(formal, "AssignmentPattern") &&
      formal.left === parameter.bindingIdentifier &&
      isNodeOfType(formal.right, "Literal") &&
      typeof formal.right.value === "boolean");
  const slot = callback.params.findIndex(isBooleanFormal);
  if (
    slot === -1 ||
    callback.params.some(
      (formal) => !isNodeOfType(formal, "Identifier") && !isBooleanFormal(formal),
    )
  )
    return null;

  const hook = callback.parent;
  if (
    !isNodeOfType(hook, "CallExpression") ||
    hook.arguments.length !== 2 ||
    hook.arguments[0] !== callback ||
    !isLiteralDependencyArray(hook.arguments[1]) ||
    !isDirectReactCall(hook, "useCallback", scopes)
  )
    return null;

  const declaration = hook.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== hook ||
    !isNodeOfType(declaration.id, "Identifier") ||
    isNodeOfType(declaration.parent?.parent, "ExportNamedDeclaration")
  )
    return null;
  const binding = scopes.symbolFor(declaration.id);
  if (
    !binding ||
    getDirectConstInitializer(binding) !== hook ||
    !isSymbolReadOnly(binding) ||
    binding.references.some((reference) => isWithinAssignmentTarget(reference.identifier))
  )
    return null;

  let argumentValue: boolean | null = null;
  for (const reference of binding.references) {
    if (isDependencyRead(reference.identifier, scopes)) continue;
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.optional ||
      call.arguments.length !== callback.params.length ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return null;
    const argument = call.arguments[slot];
    if (
      !isNodeOfType(argument, "Literal") ||
      typeof argument.value !== "boolean" ||
      (argumentValue !== null && argument.value !== argumentValue)
    )
      return null;
    argumentValue = argument.value;
  }

  if (
    argumentValue === null ||
    !hasCompleteSymbolReferences(binding, program, scopes) ||
    !hasCompleteSymbolReferences(parameter, program, scopes) ||
    !hasClosedReactAndLexicalExecution(program, scopes) ||
    !hasStableHookOrder(hook, context)
  )
    return null;
  return argumentValue;
};

export const isInClosedBooleanCallbackDeadBranch = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(node);
  if (!program || program.sourceType !== "module") return false;
  for (
    let descendant = node, ancestor = node.parent;
    ancestor;
    descendant = ancestor, ancestor = ancestor.parent
  ) {
    if (
      !isNodeOfType(ancestor, "IfStatement") ||
      (descendant !== ancestor.consequent && descendant !== ancestor.alternate)
    )
      continue;
    const test = stripParenExpression(ancestor.test);
    const negated = isNodeOfType(test, "UnaryExpression") && test.operator === "!";
    const condition = negated ? stripParenExpression(test.argument) : test;
    const value = getClosedBooleanArgument(condition, context, program);
    if (value !== null && (negated ? !value : value) !== (descendant === ancestor.consequent))
      return true;
  }
  return false;
};
