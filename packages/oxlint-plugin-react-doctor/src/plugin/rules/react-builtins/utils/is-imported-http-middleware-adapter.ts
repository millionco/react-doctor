import { normalize } from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import {
  hasStandardNextModuleResolution,
  hasStandardProviderOverrides,
} from "./has-standard-next-module-resolution.js";

const isSameBinding = (
  node: EsTreeNode | undefined,
  binding: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "Identifier") || !isNodeOfType(binding, "Identifier")) return false;
  const expected = scopes.symbolFor(binding);
  return expected !== null && scopes.symbolFor(node) === expected;
};

const isGlobalName = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

const isClosedArrow = (
  node: EsTreeNode | null | undefined,
  arity: number,
): node is EsTreeNodeOfType<"ArrowFunctionExpression"> =>
  isNodeOfType(node, "ArrowFunctionExpression") &&
  !node.async &&
  node.params.length === arity &&
  node.params.every((parameter) => isNodeOfType(parameter, "Identifier"));

const getOnlyExpression = (
  arrow: EsTreeNodeOfType<"ArrowFunctionExpression">,
): EsTreeNode | null => {
  if (!isNodeOfType(arrow.body, "BlockStatement")) return stripParenExpression(arrow.body);
  if (arrow.body.body.length !== 1) return null;
  const [statement] = arrow.body.body;
  if (!isNodeOfType(statement, "ExpressionStatement")) return getSingleReturnExpression(arrow);
  return stripParenExpression(statement.expression);
};

const isResultCallback = (
  callback: EsTreeNode | undefined,
  resolve: EsTreeNode,
  reject: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isClosedArrow(callback, 1)) return false;
  const [result] = callback.params;
  const invokes = (node: EsTreeNode | null | undefined, target: EsTreeNode): boolean =>
    isNodeOfType(node, "CallExpression") &&
    !node.optional &&
    node.arguments.length === 1 &&
    isSameBinding(node.callee, target, scopes) &&
    isSameBinding(node.arguments[0], result, scopes);
  const testsError = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "BinaryExpression") &&
    node.operator === "instanceof" &&
    isSameBinding(node.left, result, scopes) &&
    isGlobalName(node.right, "Error", scopes);
  const expression = getSingleReturnExpression(callback);
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      testsError(expression.test) &&
      invokes(expression.consequent, reject) &&
      invokes(expression.alternate, resolve)
    );
  }
  if (!isNodeOfType(callback.body, "BlockStatement") || callback.body.body.length !== 2)
    return false;
  const [check, success] = callback.body.body;
  if (!isNodeOfType(check, "IfStatement") || check.alternate || !testsError(check.test))
    return false;
  const failure =
    isNodeOfType(check.consequent, "BlockStatement") && check.consequent.body.length === 1
      ? check.consequent.body[0]
      : check.consequent;
  return (
    isNodeOfType(failure, "ReturnStatement") &&
    invokes(failure.argument, reject) &&
    isNodeOfType(success, "ReturnStatement") &&
    invokes(success.argument, resolve)
  );
};

const isPromiseAdapter = (factory: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isFunctionLike(factory) ||
    factory.async ||
    factory.generator ||
    factory.params.length !== 1 ||
    !isNodeOfType(factory.params[0], "Identifier")
  )
    return false;
  const wrapper = getSingleReturnExpression(factory);
  if (!isClosedArrow(wrapper, 2)) return false;
  const promise = getSingleReturnExpression(wrapper);
  if (
    !isNodeOfType(promise, "NewExpression") ||
    !isGlobalName(promise.callee, "Promise", scopes) ||
    promise.arguments.length !== 1
  )
    return false;
  const executor = promise.arguments[0];
  if (!isClosedArrow(executor, 2)) return false;
  const invoke = getOnlyExpression(executor);
  if (
    !isNodeOfType(invoke, "CallExpression") ||
    invoke.optional ||
    invoke.arguments.length !== 3 ||
    !isSameBinding(invoke.callee, factory.params[0], scopes) ||
    !isSameBinding(invoke.arguments[0], wrapper.params[0], scopes) ||
    !isSameBinding(invoke.arguments[1], wrapper.params[1], scopes)
  )
    return false;
  return isResultCallback(invoke.arguments[2], executor.params[0], executor.params[1], scopes);
};

const AMBIENT_REPLACEMENT_NAMES = new Set([
  "global",
  "globalThis",
  "window",
  "self",
  "eval",
  "require",
  "Function",
  "Reflect",
]);

const hasStandardPromiseAndError = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let valid = true;
  walkAst(program, (node) => {
    if (!valid) return false;
    if (isNodeOfType(node, "WithStatement")) {
      valid = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (AMBIENT_REPLACEMENT_NAMES.has(node.name)) {
      valid = false;
      return false;
    }
    const use = node.parent;
    if (node.name === "Promise" || node.name === "Error") {
      if (isNodeOfType(use, "NewExpression") && use.callee === node) return;
      if (
        node.name === "Error" &&
        isNodeOfType(use, "BinaryExpression") &&
        use.operator === "instanceof" &&
        use.right === node
      )
        return;
      if (
        node.name === "Promise" &&
        isNodeOfType(use, "MemberExpression") &&
        !use.computed &&
        use.object === node &&
        isNodeOfType(use.parent, "CallExpression") &&
        use.parent.callee === use
      )
        return;
      valid = false;
    }
  });
  return valid;
};

const isStockCorsFactoryCall = (
  node: EsTreeNode,
  filename: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== 0 ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const binding = scopes.symbolFor(node.callee);
  if (
    !binding ||
    !isSymbolReadOnly(binding) ||
    !isNodeOfType(binding.declarationNode, "ImportDefaultSpecifier")
  )
    return false;
  const declaration = getImportDeclarationForSymbol(binding);
  if (
    declaration?.source.value !== "cors" ||
    declaration.importKind === "type" ||
    declaration.attributes?.length ||
    resolveModulePath(filename, "cors")
  )
    return false;
  const specifier = readNearestPackageManifest(filename)?.dependencies?.cors;
  return typeof specifier === "string" && /^\^?2\.8\.5$/.test(specifier);
};

export const isImportedHttpMiddlewareAdapter = (
  call: EsTreeNodeOfType<"CallExpression">,
  enclosingFunction: EsTreeNode,
  context: Pick<RuleContext, "filename" | "scopes">,
): boolean => {
  if (
    !context.filename ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.optional ||
    call.arguments.length !== 2 ||
    !isNodeOfType(call.parent, "AwaitExpression") ||
    call.parent.argument !== call ||
    !isFunctionLike(enclosingFunction) ||
    enclosingFunction.params.length !== 2 ||
    !isSameBinding(call.arguments[0], enclosingFunction.params[0], context.scopes) ||
    !isSameBinding(call.arguments[1], enclosingFunction.params[1], context.scopes)
  )
    return false;
  const imported = resolveImportedApiReference(call.callee, context.scopes);
  if (!imported?.importedName || imported.importedName === "default") return false;
  const resolved = resolveCrossFileValueExportWithFilePath(
    context.filename,
    imported.source,
    imported.importedName,
  );
  if (!resolved || !isNodeOfType(resolved.exportedNode, "CallExpression")) return false;
  const initialize = resolved.exportedNode;
  if (
    initialize.optional ||
    initialize.arguments.length !== 1 ||
    !isNodeOfType(initialize.callee, "Identifier") ||
    !isNodeOfType(initialize.parent, "VariableDeclarator")
  )
    return false;
  const scopes = analyzeScopes(resolved.programNode);
  const adapter = scopes.symbolFor(initialize.parent.id);
  const factory = scopes.symbolFor(initialize.callee);
  if (
    !adapter ||
    !isSymbolReadOnly(adapter) ||
    getDirectConstInitializer(adapter) !== initialize ||
    !factory ||
    !isSymbolReadOnly(factory) ||
    !factory.initializer
  )
    return false;

  if (
    !isPromiseAdapter(factory.initializer, scopes) ||
    !isStockCorsFactoryCall(initialize.arguments[0], resolved.filePath, scopes)
  )
    return false;
  const packageDirectory = findNearestPackageDirectory(context.filename);
  const adapterPackageDirectory = findNearestPackageDirectory(resolved.filePath);
  const next = readNearestPackageManifest(context.filename)?.dependencies?.next;
  return Boolean(
    packageDirectory &&
    adapterPackageDirectory &&
    normalize(packageDirectory) === normalize(adapterPackageDirectory) &&
    next === "14.0.3" &&
    hasStandardNextModuleResolution(packageDirectory) &&
    hasStandardProviderOverrides(packageDirectory) &&
    hasStandardPromiseAndError(resolved.programNode, scopes) &&
    hasStandardPromiseAndError(context.scopes.rootScope.node, context.scopes),
  );
};
