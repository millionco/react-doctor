import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { hasCrossFileReactDefaultProviderMutation } from "./has-cross-file-react-default-provider-mutation.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenSynchronousRenderCallback } from "./is-proven-synchronous-render-callback.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ImportedCallbackSemantics {
  readonly scopes: RuleContext["scopes"];
  readonly cfg: RuleContext["cfg"];
}

const CALLBACK_REACHABILITY_OPTIONS = { evaluatePrimitiveLiteralTruthiness: true };

const semanticsByProgram = new WeakMap<EsTreeNode, ImportedCallbackSemantics>();
const callbackProofByFunction = new WeakMap<
  EsTreeNode,
  Map<number, readonly (readonly EsTreeNode[])[]>
>();

export const isImportedRenderCallback = (callback: EsTreeNode, context: RuleContext): boolean => {
  if (
    !context.filename ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 0
  ) {
    return false;
  }
  let hasOpaqueCallbackInputs = false;
  walkAst(callback.body, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    ) {
      hasOpaqueCallbackInputs = true;
      return false;
    }
  });
  if (hasOpaqueCallbackInputs) return false;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const call = callbackRoot.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeReachableWithinFunction(call, context, CALLBACK_REACHABILITY_OPTIONS)
  ) {
    return false;
  }
  const callbackIndex = call.arguments.findIndex((argument) => argument === callbackRoot);
  const callee = stripParenExpression(call.callee);
  if (callbackIndex < 0 || !isNodeOfType(callee, "Identifier")) return false;
  const importSymbol = context.scopes.symbolFor(callee);
  if (
    importSymbol?.kind !== "import" ||
    importSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  const imported = resolveImportedApiReference(callee, context.scopes);
  if (!imported?.importedName || !imported.source.startsWith(".")) return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    imported.source,
    imported.importedName,
  );
  const helper = resolved?.functionNode;
  if (!resolved || !isFunctionLike(helper) || helper.async || helper.generator) return false;
  const parameter = helper.params[callbackIndex];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const cachedProof = callbackProofByFunction.get(helper)?.get(callbackIndex);
  let semantics = semanticsByProgram.get(resolved.programNode);
  if (!semantics) {
    semantics = {
      scopes: analyzeScopes(resolved.programNode),
      cfg: analyzeControlFlow(resolved.programNode),
    };
    semanticsByProgram.set(resolved.programNode, semantics);
  }
  const { scopes, cfg } = semantics;
  const hasSupportedCallerPath = (paths: readonly (readonly EsTreeNode[])[]): boolean =>
    paths.some((nativeCalls) =>
      nativeCalls.every(
        (nativeCall) =>
          !hasCrossFileReactDefaultProviderMutation(nativeCall, scopes, context.scopes),
      ),
    );
  if (cachedProof !== undefined) return hasSupportedCallerPath(cachedProof);
  if (
    getFunctionBindingSymbols(helper, scopes).some(
      (binding) =>
        (binding.kind !== "const" && binding.kind !== "function") ||
        binding.references.some(
          (reference) =>
            reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
        ),
    )
  ) {
    return false;
  }
  let hasOpaqueParameterAccess = false;
  walkAst(resolved.programNode, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "arguments" || (node.name === "eval" && scopes.isGlobalReference(node)))
    ) {
      hasOpaqueParameterAccess = true;
      return false;
    }
  });
  if (hasOpaqueParameterAccess) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  if (!parameterSymbol || parameterSymbol.references.length === 0) return false;
  const helperContext = {
    ...context,
    filename: resolved.filePath,
    scopes,
    cfg,
  };
  const renderInvocationPaths: EsTreeNode[][] = [];
  for (const reference of parameterSymbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const invocation = referenceRoot.parent;
    if (
      reference.flag !== "read" ||
      isBindingAssignmentTarget(reference.identifier) ||
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.callee !== referenceRoot ||
      invocation.optional
    ) {
      return false;
    }
    const nativeCalls: EsTreeNode[] = [];
    let executionNode: EsTreeNode = invocation;
    let owner = findEnclosingFunction(executionNode);
    while (owner && owner !== helper) {
      if (
        !isFunctionLike(owner) ||
        owner.async ||
        owner.generator ||
        !isAstDescendant(executionNode, owner.body) ||
        !isNodeOnUnconditionalPath(executionNode, owner) ||
        !isNodeReachableWithinFunction(
          executionNode,
          helperContext,
          CALLBACK_REACHABILITY_OPTIONS,
        ) ||
        !isProvenSynchronousRenderCallback(owner, scopes)
      ) {
        break;
      }
      executionNode = findTransparentExpressionRoot(owner).parent ?? owner;
      if (isNodeOfType(executionNode, "CallExpression")) {
        nativeCalls.push(executionNode);
      }
      owner = findEnclosingFunction(owner);
    }
    if (
      owner === helper &&
      isAstDescendant(executionNode, helper.body) &&
      isNodeOnUnconditionalPath(executionNode, helper) &&
      isNodeReachableWithinFunction(executionNode, helperContext, CALLBACK_REACHABILITY_OPTIONS)
    ) {
      renderInvocationPaths.push(nativeCalls);
    }
  }
  const proofs =
    callbackProofByFunction.get(helper) ?? new Map<number, readonly (readonly EsTreeNode[])[]>();
  proofs.set(callbackIndex, renderInvocationPaths);
  callbackProofByFunction.set(helper, proofs);
  return hasSupportedCallerPath(renderInvocationPaths);
};
