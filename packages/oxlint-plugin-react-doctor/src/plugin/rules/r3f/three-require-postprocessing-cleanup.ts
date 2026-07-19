import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  expressionMatchesOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
  type OwnedLifecycleResourceAnalysis,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";

const POSTPROCESSING_BORROWING_METHOD_NAMES = new Set<string>();
const THREE_COMPOSER_BORROWING_METHOD_NAMES = new Set(["addPass", "insertPass"]);
const THREE_RESOURCE_OWNING_PASS_CONSTRUCTORS = new Set([
  "AfterimagePass",
  "BloomPass",
  "BokehPass",
  "CubeTexturePass",
  "DotScreenPass",
  "FilmPass",
  "FXAAPass",
  "GTAOPass",
  "GlitchPass",
  "HalftonePass",
  "LUTPass",
  "OutlinePass",
  "OutputPass",
  "RenderPixelatedPass",
  "RenderTransitionPass",
  "SAOPass",
  "SMAAPass",
  "SSAARenderPass",
  "SSAOPass",
  "SSRPass",
  "SavePass",
  "ShaderPass",
  "TAARenderPass",
  "TexturePass",
  "UnrealBloomPass",
]);

const isModernThreeComposer = (apiName: string, moduleSource: string): boolean =>
  apiName === "EffectComposer" && moduleSource === "three/addons/postprocessing/EffectComposer.js";

const isPmndrsComposer = (apiName: string, moduleSource: string): boolean =>
  apiName === "EffectComposer" && moduleSource === "postprocessing";

const isModernThreeResourceOwningPass = (apiName: string, moduleSource: string): boolean =>
  THREE_RESOURCE_OWNING_PASS_CONSTRUCTORS.has(apiName) &&
  moduleSource === `three/addons/postprocessing/${apiName}.js`;

const isBorrowedByOwnedThreeComposer = (
  call: EsTreeNodeOfType<"CallExpression">,
  composerAnalyses: readonly OwnedLifecycleResourceAnalysis[],
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !THREE_COMPOSER_BORROWING_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
  ) {
    return false;
  }
  return composerAnalyses.some(
    (analysis) =>
      !analysis.hasUnknownOwnershipTransfer &&
      expressionMatchesOwnedLifecycleResource(callee.object, analysis, context.scopes),
  );
};

const reportMissingDisposal = (
  allocation: EsTreeNodeOfType<"NewExpression">,
  analysis: OwnedLifecycleResourceAnalysis,
  context: RuleContext,
): void => {
  if (analysis.hasUnknownOwnershipTransfer) return;
  const cleanup = analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
    functionInvokesOwnedResourceMethod(cleanupFunction, analysis, "dispose", context.scopes),
  );
  if (cleanup.isProven || cleanup.isUnknown) return;
  context.report({
    node: allocation,
    message:
      "This component-owned postprocessing resource has no provable React cleanup, so its GPU resources can survive dependency changes or unmount",
  });
};

export const threeRequirePostprocessingCleanup = defineRule({
  id: "three-require-postprocessing-cleanup",
  title: "Undisposed Three.js postprocessing resource",
  category: "Correctness",
  severity: "warn",
  recommendation: "Dispose component-owned postprocessing composers and resource-owning passes",
  create: (context: RuleContext) => ({
    Program(program: EsTreeNodeOfType<"Program">) {
      const composerAllocations: EsTreeNodeOfType<"NewExpression">[] = [];
      const passAllocations: EsTreeNodeOfType<"NewExpression">[] = [];
      walkAst(program, (candidate: EsTreeNode) => {
        if (!isNodeOfType(candidate, "NewExpression")) return;
        const provenance = getApiReferenceProvenance(candidate.callee, context.scopes);
        if (!provenance) return;
        if (
          isModernThreeComposer(provenance.apiName, provenance.moduleSource) ||
          isPmndrsComposer(provenance.apiName, provenance.moduleSource)
        ) {
          composerAllocations.push(candidate);
          return;
        }
        if (isModernThreeResourceOwningPass(provenance.apiName, provenance.moduleSource)) {
          passAllocations.push(candidate);
        }
      });
      const composerAnalysisByAllocation = new Map<
        EsTreeNodeOfType<"NewExpression">,
        OwnedLifecycleResourceAnalysis
      >();
      for (const allocation of composerAllocations) {
        const analysis = analyzeOwnedLifecycleResource(allocation, context, {
          borrowedArgumentMethodNames: POSTPROCESSING_BORROWING_METHOD_NAMES,
          retainsOwnershipInJsx: true,
        });
        if (analysis) composerAnalysisByAllocation.set(allocation, analysis);
      }
      const threeComposerAnalyses = [...composerAnalysisByAllocation.values()].filter(
        (analysis) => {
          const allocation = analysis.allocation;
          if (!isNodeOfType(allocation, "NewExpression")) return false;
          const provenance = getApiReferenceProvenance(allocation.callee, context.scopes);
          return Boolean(
            provenance && isModernThreeComposer(provenance.apiName, provenance.moduleSource),
          );
        },
      );
      for (const allocation of composerAllocations) {
        const analysis = composerAnalysisByAllocation.get(allocation);
        if (analysis) reportMissingDisposal(allocation, analysis, context);
      }
      for (const allocation of passAllocations) {
        const analysis = analyzeOwnedLifecycleResource(allocation, context, {
          borrowedArgumentMethodNames: POSTPROCESSING_BORROWING_METHOD_NAMES,
          isBorrowedArgument: (call) =>
            isBorrowedByOwnedThreeComposer(call, threeComposerAnalyses, context),
          retainsOwnershipInJsx: true,
        });
        if (analysis) reportMissingDisposal(allocation, analysis, context);
      }
    },
  }),
});
