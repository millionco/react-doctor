import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { resolveRemotionApi } from "./resolve-remotion-api.js";
import { walkAst } from "./walk-ast.js";

const REMOTION_RENDER_CALL_NAMES = new Set([
  "continueRender",
  "delayRender",
  "getInputProps",
  "random",
  "spring",
  "useCurrentFrame",
  "useDelayRender",
  "useVideoConfig",
]);

const REMOTION_RENDER_COMPONENT_NAMES = new Set([
  "Audio",
  "Freeze",
  "IFrame",
  "Img",
  "Loop",
  "OffthreadVideo",
  "Sequence",
  "Series",
  "Video",
]);

export interface RemotionRenderEvidenceChecker {
  functionHasEvidence: (functionNode: EsTreeNode) => boolean;
}

export const createRemotionRenderEvidenceChecker = (
  scopes: ScopeAnalysis,
): RemotionRenderEvidenceChecker => {
  const evidenceByFunction = new WeakMap<object, boolean>();
  const registeredCompositionFunctions = new WeakSet<object>();
  const inspectedPrograms = new WeakSet<object>();

  const collectRegisteredCompositionFunctions = (functionNode: EsTreeNode): void => {
    const program = findProgramRoot(functionNode);
    if (!program || inspectedPrograms.has(program)) return;
    inspectedPrograms.add(program);
    walkAst(program, (candidate) => {
      if (!isNodeOfType(candidate, "JSXOpeningElement")) return;
      const apiBinding = resolveRemotionApi(candidate.name, scopes);
      if (apiBinding?.apiName !== "Composition" || apiBinding.moduleSource !== "remotion") return;
      const componentAttribute = findJsxAttribute(candidate.attributes, "component");
      if (
        !componentAttribute?.value ||
        !isNodeOfType(componentAttribute.value, "JSXExpressionContainer") ||
        !componentAttribute.value.expression
      ) {
        return;
      }
      const registeredFunction = resolveExactLocalFunction(
        componentAttribute.value.expression,
        scopes,
      );
      if (registeredFunction) registeredCompositionFunctions.add(registeredFunction);
    });
  };

  const functionUsesRemotionRenderApi = (functionNode: EsTreeNode): boolean => {
    let hasEvidence = false;
    walkAst(functionNode, (candidate) => {
      if (hasEvidence) return false;
      if (
        !isNodeOfType(candidate, "CallExpression") &&
        !isNodeOfType(candidate, "JSXOpeningElement")
      ) {
        return;
      }
      const reference = isNodeOfType(candidate, "CallExpression")
        ? candidate.callee
        : candidate.name;
      const apiBinding = resolveRemotionApi(reference, scopes);
      if (apiBinding?.moduleSource !== "remotion") return;
      if (
        (isNodeOfType(candidate, "CallExpression") &&
          REMOTION_RENDER_CALL_NAMES.has(apiBinding.apiName)) ||
        (isNodeOfType(candidate, "JSXOpeningElement") &&
          REMOTION_RENDER_COMPONENT_NAMES.has(apiBinding.apiName))
      ) {
        hasEvidence = true;
        return false;
      }
    });
    return hasEvidence;
  };

  return {
    functionHasEvidence: (functionNode) => {
      const cachedEvidence = evidenceByFunction.get(functionNode);
      if (cachedEvidence !== undefined) return cachedEvidence;
      collectRegisteredCompositionFunctions(functionNode);
      const hasEvidence =
        registeredCompositionFunctions.has(functionNode) ||
        functionUsesRemotionRenderApi(functionNode);
      evidenceByFunction.set(functionNode, hasEvidence);
      return hasEvidence;
    },
  };
};
