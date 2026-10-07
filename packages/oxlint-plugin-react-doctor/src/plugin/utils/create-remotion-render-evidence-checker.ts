import { createRemotionCompositionOwnershipAnalyzer } from "./create-remotion-composition-ownership-analyzer.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
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

interface RemotionRenderEvidenceState {
  readonly evidenceByFunction: WeakMap<object, boolean>;
  readonly inspectedPrograms: WeakSet<object>;
  readonly isOwnedByRegisteredComposition: (functionNode: EsTreeNode) => boolean;
  readonly registeredCompositionFunctions: WeakSet<object>;
}

const REMOTION_RENDER_EVIDENCE_STATES = new WeakMap<
  ScopeAnalysis,
  WeakMap<object, Map<string, RemotionRenderEvidenceState>>
>();

export const createRemotionRenderEvidenceChecker = (
  context: RuleContext,
): RemotionRenderEvidenceChecker => {
  const scopes = context.scopes;
  let statesBySettings = REMOTION_RENDER_EVIDENCE_STATES.get(scopes);
  if (!statesBySettings) {
    statesBySettings = new WeakMap();
    REMOTION_RENDER_EVIDENCE_STATES.set(scopes, statesBySettings);
  }
  const settingsKey = context.settings ?? scopes;
  let statesByFilename = statesBySettings.get(settingsKey);
  if (!statesByFilename) {
    statesByFilename = new Map();
    statesBySettings.set(settingsKey, statesByFilename);
  }
  const filename = context.filename ?? "";
  let state = statesByFilename.get(filename);
  if (!state) {
    state = {
      evidenceByFunction: new WeakMap(),
      registeredCompositionFunctions: new WeakSet(),
      inspectedPrograms: new WeakSet(),
      isOwnedByRegisteredComposition: createRemotionCompositionOwnershipAnalyzer(context),
    };
    statesByFilename.set(filename, state);
  }
  const {
    evidenceByFunction,
    inspectedPrograms,
    isOwnedByRegisteredComposition,
    registeredCompositionFunctions,
  } = state;

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
