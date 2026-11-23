import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import { resolveImportedExportName } from "../../../utils/find-exported-function-body.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";

type FunctionNode = EsTreeNodeOfType<
  "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
>;

interface SourceScope {
  readonly filename: string | undefined;
  readonly scopes: ScopeAnalysis;
}

interface ResolvedFunction extends SourceScope {
  readonly node: FunctionNode;
}

const isSynchronousFunction = (node: EsTreeNode | null | undefined): node is FunctionNode =>
  isFunctionLike(node) &&
  !node.async &&
  !(
    (isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "FunctionDeclaration")) &&
    node.generator
  );

const currentMember = (expression: EsTreeNode | null | undefined) => {
  if (!expression) return null;
  const node = stripParenExpression(expression);
  return isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    !node.optional &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === "current"
    ? node
    : null;
};

const hasDynamicScopeByProgram = new WeakMap<EsTreeNode, boolean>();
const importedScopesByProgram = new WeakMap<EsTreeNode, ScopeAnalysis>();

const isClosedSymbol = (symbol: SymbolDescriptor, source: SourceScope): boolean => {
  const program = findProgramRoot(symbol.bindingIdentifier);
  if (
    !program ||
    !isSymbolReadOnly(symbol) ||
    !hasCompleteSymbolReferences(symbol, program, source.scopes)
  )
    return false;
  const cached = hasDynamicScopeByProgram.get(program);
  if (cached !== undefined) return !cached;
  let hasDynamicScope = false;
  walkAst(program, (node) => {
    if (hasDynamicScope) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "eval" &&
        source.scopes.isGlobalReference(node.callee))
    ) {
      hasDynamicScope = true;
      return false;
    }
  });
  hasDynamicScopeByProgram.set(program, hasDynamicScope);
  return !hasDynamicScope;
};

const resolveFunction = (
  call: EsTreeNodeOfType<"CallExpression">,
  source: SourceScope,
): ResolvedFunction | null => {
  if (call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const symbol = source.scopes.symbolFor(callee);
  if (!symbol || !isClosedSymbol(symbol, source)) return null;
  const local = resolveExactLocalFunction(callee, source.scopes);
  if (isSynchronousFunction(local)) return { ...source, node: local };

  const imported = getImportDeclarationForSymbol(symbol);
  if (
    !source.filename ||
    !imported ||
    imported.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    Boolean(imported.attributes?.length) ||
    typeof imported.source.value !== "string" ||
    !(imported.source.value.startsWith("./") || imported.source.value.startsWith("../"))
  )
    return null;

  const exportedName = resolveImportedExportName(symbol.declarationNode);
  if (!exportedName) return null;
  // Both resolvers report filesystem probes, including missing alternatives.
  // Require the body in the directly resolved module, without barrel forwarding.
  const filename = resolveModulePath(source.filename, imported.source.value);
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    source.filename,
    imported.source.value,
    exportedName,
  );
  if (!resolved || resolved.filePath !== filename || !isSynchronousFunction(resolved.functionNode))
    return null;
  let scopes = importedScopesByProgram.get(resolved.programNode);
  if (!scopes) {
    scopes = analyzeScopes(resolved.programNode);
    importedScopesByProgram.set(resolved.programNode, scopes);
  }
  const functionNode = resolved.functionNode;
  const declaration = isNodeOfType(functionNode, "FunctionDeclaration")
    ? functionNode
    : isNodeOfType(functionNode.parent, "VariableDeclarator")
      ? functionNode.parent.parent
      : null;
  const exportNode = declaration?.parent;
  if (
    !isNodeOfType(exportNode, "ExportNamedDeclaration") ||
    exportNode.declaration !== declaration
  ) {
    return null;
  }
  const bindings = getFunctionBindingSymbols(functionNode, scopes);
  const provider = { filename, scopes, node: functionNode };
  return bindings.length > 0 &&
    bindings.every((binding) => binding.name === exportedName && isClosedSymbol(binding, provider))
    ? provider
    : null;
};

const effectCall = (callback: FunctionNode, scopes: ScopeAnalysis) => {
  const call = callback.parent;
  return isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length === 2 &&
    call.arguments[0] === callback &&
    callback.params.length === 0 &&
    isReactApiCall(call, "useEffect", scopes) &&
    isNodeOfType(call.arguments[1], "ArrayExpression")
    ? call
    : null;
};

const isCleanup = (callback: FunctionNode, owner: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const parent = callback.parent;
  let setup: EsTreeNode | null | undefined = parent;
  if (isNodeOfType(parent, "ReturnStatement")) {
    if (parent.argument !== callback) return false;
    setup = parent.parent?.parent;
    if (!isFunctionLike(setup) || setup.body !== parent.parent) return false;
  } else if (!isNodeOfType(parent, "ArrowFunctionExpression") || parent.body !== callback) {
    return false;
  }
  if (!isSynchronousFunction(setup) || findEnclosingFunction(setup) !== owner) return false;
  const deps = effectCall(setup, scopes)?.arguments[1];
  return isNodeOfType(deps, "ArrayExpression") && deps.elements.length === 0;
};

const hasAcquisitionGuard = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  effect: FunctionNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  for (
    let child: EsTreeNode = assignment;
    child.parent && child.parent !== effect;
    child = child.parent
  ) {
    const parent: EsTreeNode = child.parent;
    if (!isNodeOfType(parent, "IfStatement") || parent.consequent !== child) continue;
    const test = stripParenExpression(parent.test);
    if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") continue;
    const guarded = currentMember(test.argument);
    if (guarded && scopes.symbolFor(guarded.object) === symbol) return true;
  }
  return false;
};

const isTeardownWrite = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  callback: FunctionNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const statement = assignment.parent;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const block = statement.parent;
  if (block === callback.body) return true;
  const guard = block?.parent;
  if (
    !isNodeOfType(block, "BlockStatement") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== block ||
    guard.parent !== callback.body
  )
    return false;
  const tested = currentMember(guard.test);
  return Boolean(tested && scopes.symbolFor(tested.object) === symbol);
};

const providerUsesArgumentsByFunction = new WeakMap<FunctionNode, boolean>();

const providerUsesArguments = (provider: FunctionNode): boolean => {
  const cached = providerUsesArgumentsByFunction.get(provider);
  if (cached !== undefined) return cached;
  let usesArguments = false;
  walkAst(provider, (node) => {
    if (usesArguments) return false;
    if (isNodeOfType(node, "Identifier") && node.name === "arguments") {
      usesArguments = true;
      return false;
    }
  });
  providerUsesArgumentsByFunction.set(provider, usesArguments);
  return usesArguments;
};

const configOnlyReadsHandle = (
  call: EsTreeNodeOfType<"CallExpression">,
  argument: EsTreeNode,
  source: SourceScope,
): boolean => {
  const provider = resolveFunction(call, source);
  if (
    !provider ||
    providerUsesArguments(provider.node) ||
    call.arguments[0] !== argument ||
    call.arguments.some((entry) => isNodeOfType(entry, "SpreadElement"))
  )
    return false;
  const parameter = provider.node.params[0];
  const symbol = isNodeOfType(parameter, "Identifier")
    ? provider.scopes.symbolFor(parameter)
    : null;
  if (!symbol || !isClosedSymbol(symbol, provider) || !symbol.references.length) return false;
  return symbol.references.every(({ identifier }) => {
    const current = currentMember(identifier.parent);
    if (!current || current.object !== identifier) return false;
    const method = current.parent;
    return (
      isNodeOfType(method, "MemberExpression") &&
      method.object === current &&
      !method.computed &&
      isNodeOfType(method.property, "Identifier") &&
      isNodeOfType(method.parent, "CallExpression") &&
      method.parent.callee === method
    );
  });
};

const isPrivateRefSlot = (
  symbol: SymbolDescriptor,
  owner: EsTreeNode,
  source: SourceScope,
  terminalReturn: EsTreeNode | null,
): boolean => {
  const initializer = getDirectConstInitializer(symbol);
  const create = initializer && stripParenExpression(initializer);
  if (
    !isClosedSymbol(symbol, source) ||
    !isNodeOfType(create, "CallExpression") ||
    create.optional ||
    !isReactApiCall(create, "useRef", source.scopes) ||
    create.arguments.length !== 1 ||
    !isNodeOfType(create.arguments[0], "Literal") ||
    create.arguments[0].value !== null
  )
    return false;

  let acquisitions = 0;
  let teardowns = 0;
  for (const { identifier } of symbol.references) {
    if (identifier === terminalReturn) continue;
    const current = currentMember(identifier.parent);
    if (!current || current.object !== identifier) {
      const call = identifier.parent;
      if (!isNodeOfType(call, "CallExpression") || !configOnlyReadsHandle(call, identifier, source))
        return false;
      continue;
    }
    if (!isWithinAssignmentTarget(current)) continue;
    const assignment = current.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.left !== current ||
      assignment.operator !== "="
    )
      return false;
    const callback = findEnclosingFunction(assignment);
    if (!isSynchronousFunction(callback)) return false;
    const value = stripParenExpression(assignment.right);
    if (isNodeOfType(value, "Literal") && value.value === null) {
      if (
        !isCleanup(callback, owner, source.scopes) ||
        !isTeardownWrite(assignment, callback, symbol, source.scopes)
      )
        return false;
      teardowns++;
    } else {
      // A construction expression yields an object or throws. No claim about
      // the constructor's identity or its object's backing storage is needed.
      if (
        !isNodeOfType(value, "NewExpression") ||
        findEnclosingFunction(callback) !== owner ||
        !effectCall(callback, source.scopes) ||
        !hasAcquisitionGuard(assignment, callback, symbol, source.scopes)
      )
        return false;
      acquisitions++;
    }
  }
  return acquisitions === 1 && teardowns === 1;
};

/** Prove the private ref container for a mount-only imperative exposure.
 * The caller still proves the matching forwarded attach and detach protocol.
 */
export const isOwnedImperativeRefHandle = (
  handleValue: EsTreeNode,
  context: Pick<RuleContext, "filename" | "scopes">,
): boolean => {
  const current = currentMember(handleValue);
  if (!current || !isNodeOfType(current.object, "Identifier")) return false;
  const source = { filename: context.filename, scopes: context.scopes };
  const symbol = source.scopes.symbolFor(current.object);
  if (!symbol) return false;
  const initializer = getDirectConstInitializer(symbol);
  const create = initializer && stripParenExpression(initializer);
  if (!isNodeOfType(create, "CallExpression") || create.optional) return false;
  const owner = findEnclosingFunction(symbol.bindingIdentifier);
  if (!owner) return false;
  if (isReactApiCall(create, "useRef", context.scopes)) {
    return isPrivateRefSlot(symbol, owner, source, null);
  }
  if (
    !isClosedSymbol(symbol, source) ||
    !symbol.references.every(({ identifier }) => {
      const read = currentMember(identifier.parent);
      return read && read.object === identifier && !isWithinAssignmentTarget(read);
    })
  )
    return false;

  const provider = resolveFunction(create, source);
  if (!provider || !isNodeOfType(provider.node.body, "BlockStatement")) return false;
  const tail = provider.node.body.body.at(-1);
  if (!isNodeOfType(tail, "ReturnStatement") || !isNodeOfType(tail.argument, "Identifier"))
    return false;
  let returns = 0;
  walkOwnFunctionScope(provider.node, (node) => {
    if (isNodeOfType(node, "ReturnStatement")) returns++;
  });
  const privateSlot = provider.scopes.symbolFor(tail.argument);
  return (
    returns === 1 &&
    privateSlot !== null &&
    findEnclosingFunction(privateSlot.bindingIdentifier) === provider.node &&
    isPrivateRefSlot(privateSlot, provider.node, provider, tail.argument)
  );
};
