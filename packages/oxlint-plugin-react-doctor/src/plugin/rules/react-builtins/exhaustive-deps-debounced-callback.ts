import { closureCaptures } from "../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  hasCanonicalLodashDebounceProvider,
  LODASH_DEBOUNCE_SUBPATH,
} from "./exhaustive-deps-debounce-provider.js";
import { isOutsideAllFunctions } from "./exhaustive-deps-low-level.js";

const getDirectImportedBinding = (expression: EsTreeNode, scopes: ScopeAnalysis) => {
  const callee = stripParenExpression(expression);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const binding = scopes.symbolFor(callee);
  return binding?.kind === "import" && isSymbolReadOnly(binding) ? binding : null;
};

const isDirectReactImport = (
  expression: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const binding = getDirectImportedBinding(expression, scopes);
  return Boolean(
    binding &&
    getValueImportSource(binding) === "react" &&
    getImportedName(binding.declarationNode) === name,
  );
};

const OBSERVED_SAFE_REACT_OBJECT_CALLS = new Set(["createContext", "memo"]);
const hasClosedReactProviderByScope = new WeakMap<ScopeAnalysis, boolean>();

const isSafeReactObjectReference = (reference: EsTreeNode): boolean => {
  const receiver = findTransparentExpressionRoot(reference);
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    member.optional ||
    !OBSERVED_SAFE_REACT_OBJECT_CALLS.has(getStaticPropertyName(member) ?? "")
  ) {
    return false;
  }
  const callee = findTransparentExpressionRoot(member);
  const call = callee.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === callee && !call.optional;
};

const isClosedReactImport = (
  declaration: EsTreeNodeOfType<"ImportDeclaration">,
  scopes: ScopeAnalysis,
): boolean =>
  declaration.specifiers.every((specifier) => {
    const binding = scopes.symbolFor(specifier.local);
    if (!binding) return false;
    if (getValueImportSource(binding) !== "react") return true;
    const name = getImportedName(specifier);
    if (
      isNodeOfType(specifier, "ImportDefaultSpecifier") ||
      isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
      name === "default"
    ) {
      return (
        isSymbolReadOnly(binding) &&
        binding.references.every(({ identifier }) => isSafeReactObjectReference(identifier))
      );
    }
    return name !== undefined && !name.startsWith("__");
  });

const hasOnlyVisibleStockReactAccess = (scopes: ScopeAnalysis): boolean => {
  const cached = hasClosedReactProviderByScope.get(scopes);
  if (cached !== undefined) return cached;
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "ImportDeclaration") && node.source.value === "react") {
      isClosed = isClosedReactImport(node, scopes);
    } else if (
      isNodeOfType(node, "Literal") &&
      (node.value === "react" || node.value === "lodash/debounce") &&
      !isNodeOfType(node.parent, "ImportDeclaration")
    ) {
      // Alternate CommonJS/dynamic loads and re-exports can expose another
      // mutable reference to the same module object.
      isClosed = false;
    } else if (isNodeOfType(node, "WithStatement")) {
      isClosed = false;
    } else if (
      isNodeOfType(node, "Identifier") &&
      node.name === "React" &&
      scopes.isGlobalReference(node)
    ) {
      isClosed = false;
    } else if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (property === "React" || property?.startsWith("__")) isClosed = false;
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval" && !node.optional) {
        isClosed = false;
      }
    }
  });
  hasClosedReactProviderByScope.set(scopes, isClosed);
  return isClosed;
};

const hasImplicitLexicalCapture = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let found = false;
  walkAst(callback, (node) => {
    if (found) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super") ||
      isNodeOfType(node, "MetaProperty") ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "arguments" &&
        scopes.isGlobalReference(node))
    ) {
      found = true;
    }
  });
  return found;
};

// Restrict newly exposed closures to direct parameters and actual stock
// refs. This also avoids applying legacy spelling-based stable-hook
// inference to an arbitrary factory-local value for the first time.
const isSupportedCallbackCapture = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  if (isOutsideAllFunctions(symbol) || symbol.kind === "parameter") return true;
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    symbol.references.some(({ flag }) => flag !== "read") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "CallExpression") &&
    !initializer.optional &&
    isDirectReactImport(initializer.callee, "useRef", scopes)
  );
};

export const resolveDebouncedDependencyCallback = (
  hookCall: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  if (
    hookCall.optional ||
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 2 ||
    !isDirectReactImport(hookCall.callee, "useCallback", context.scopes)
  ) {
    return null;
  }
  const [rawCallback, rawWait] = expression.arguments;
  const callback = stripParenExpression(rawCallback);
  const wait = stripParenExpression(rawWait);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(wait, "Literal") ||
    typeof wait.value !== "number" ||
    !Number.isFinite(wait.value) ||
    wait.value < 0
  ) {
    return null;
  }
  const factory = getDirectImportedBinding(expression.callee, context.scopes);
  if (
    !factory ||
    !isNodeOfType(factory.declarationNode, "ImportDefaultSpecifier") ||
    getValueImportSource(factory) !== LODASH_DEBOUNCE_SUBPATH ||
    hasImplicitLexicalCapture(callback, context.scopes) ||
    !closureCaptures(callback, context.scopes).every(
      ({ resolvedSymbol }) =>
        !resolvedSymbol || isSupportedCallbackCapture(resolvedSymbol, context.scopes),
    ) ||
    !hasOnlyVisibleStockReactAccess(context.scopes) ||
    !hasCanonicalLodashDebounceProvider(context.filename)
  ) {
    return null;
  }
  return callback;
};
