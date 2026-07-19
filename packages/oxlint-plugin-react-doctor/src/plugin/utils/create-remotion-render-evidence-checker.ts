import { createRemotionCompositionOwnershipAnalyzer } from "./create-remotion-composition-ownership-analyzer.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { resolveRemotionApi } from "./resolve-remotion-api.js";
import type { RuleContext } from "./rule-context.js";
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

const REMOTION_RENDER_COMPONENT_MODULE_BY_NAME = new Map([
  ["Audio", "@remotion/media"],
  ["Freeze", "remotion"],
  ["IFrame", "remotion"],
  ["Img", "remotion"],
  ["Loop", "remotion"],
  ["OffthreadVideo", "remotion"],
  ["Sequence", "remotion"],
  ["Series", "remotion"],
  ["Video", "@remotion/media"],
]);

export interface RemotionRenderEvidenceChecker {
  functionHasEvidence: (functionNode: EsTreeNode) => boolean;
}

export const createRemotionRenderEvidenceChecker = (
  context: RuleContext,
): RemotionRenderEvidenceChecker => {
  const scopes = context.scopes;
  const evidenceByFunction = new WeakMap<object, boolean>();
  const registeredCompositionFunctions = new WeakSet<object>();
  const inspectedPrograms = new WeakSet<object>();
  const isOwnedByRegisteredComposition = createRemotionCompositionOwnershipAnalyzer(context);

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
      if (
        (isNodeOfType(candidate, "CallExpression") &&
          apiBinding?.moduleSource === "remotion" &&
          REMOTION_RENDER_CALL_NAMES.has(apiBinding.apiName)) ||
        (isNodeOfType(candidate, "JSXOpeningElement") &&
          apiBinding !== null &&
          REMOTION_RENDER_COMPONENT_MODULE_BY_NAME.get(apiBinding.apiName) ===
            apiBinding.moduleSource)
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
        functionUsesRemotionRenderApi(functionNode) ||
        isOwnedByRegisteredComposition(functionNode);
      evidenceByFunction.set(functionNode, hasEvidence);
      return hasEvidence;
    },
  };
};
