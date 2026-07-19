import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
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
import {
  THREE_PASS_DISPOSAL_BASE_RELEASE,
  THREE_POSTPROCESSING_BARREL_RELEASE,
  THREE_POSTPROCESSING_COMPOSER_DISPOSAL_RELEASE,
  THREE_POSTPROCESSING_PASS_DISPOSAL_RELEASES,
} from "./constants.js";

const POSTPROCESSING_BORROWING_METHOD_NAMES = new Set<string>();
const THREE_COMPOSER_BORROWING_METHOD_NAMES = new Set(["addPass", "insertPass"]);
const THREE_POSTPROCESSING_MODULE_PREFIXES = [
  "three/addons/postprocessing/",
  "three/examples/jsm/postprocessing/",
];
const THREE_POSTPROCESSING_BARREL_MODULES = new Set([
  "three/addons",
  "three/addons/Addons",
  "three/addons/Addons.js",
  "three/examples/jsm/Addons",
  "three/examples/jsm/Addons.js",
]);
const THREE_RESOURCE_OWNING_PASS_CONSTRUCTORS = new Set([
  "AdaptiveToneMappingPass",
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
const THREE_PASSES_WITH_BASE_RELEASE_DISPOSAL = new Set([
  "AdaptiveToneMappingPass",
  "OutlinePass",
  "SSAARenderPass",
  "SSAOPass",
  "SSRPass",
  "UnrealBloomPass",
]);

const isThreePostprocessingModule = (apiName: string, moduleSource: string): boolean =>
  THREE_POSTPROCESSING_BARREL_MODULES.has(moduleSource) ||
  THREE_POSTPROCESSING_MODULE_PREFIXES.some(
    (modulePrefix) =>
      moduleSource === `${modulePrefix}${apiName}` ||
      moduleSource === `${modulePrefix}${apiName}.js`,
  );

const getThreePostprocessingDisposalRelease = (apiName: string, moduleSource: string): number => {
  const resourceRelease =
    THREE_POSTPROCESSING_PASS_DISPOSAL_RELEASES.get(apiName) ??
    (apiName !== "EffectComposer" && THREE_PASSES_WITH_BASE_RELEASE_DISPOSAL.has(apiName)
      ? THREE_PASS_DISPOSAL_BASE_RELEASE
      : THREE_POSTPROCESSING_COMPOSER_DISPOSAL_RELEASE);
  const moduleRelease = THREE_POSTPROCESSING_BARREL_MODULES.has(moduleSource)
    ? THREE_POSTPROCESSING_BARREL_RELEASE
    : resourceRelease;
  return Math.max(resourceRelease, moduleRelease);
};

const canDisposeThreePostprocessingResource = (
  apiName: string,
  moduleSource: string,
  context: RuleContext,
): boolean =>
  hasCapability(
    context.settings,
    `three:${getThreePostprocessingDisposalRelease(apiName, moduleSource)}`,
  );

const isThreeComposer = (apiName: string, moduleSource: string): boolean =>
  apiName === "EffectComposer" && isThreePostprocessingModule(apiName, moduleSource);

const isPmndrsComposer = (apiName: string, moduleSource: string): boolean =>
  apiName === "EffectComposer" && moduleSource === "postprocessing";

const isThreeResourceOwningPass = (apiName: string, moduleSource: string): boolean =>
  THREE_RESOURCE_OWNING_PASS_CONSTRUCTORS.has(apiName) &&
  isThreePostprocessingModule(apiName, moduleSource);

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
          (isThreeComposer(provenance.apiName, provenance.moduleSource) &&
            canDisposeThreePostprocessingResource(
              provenance.apiName,
              provenance.moduleSource,
              context,
            )) ||
          isPmndrsComposer(provenance.apiName, provenance.moduleSource)
        ) {
          composerAllocations.push(candidate);
          return;
        }
        if (
          isThreeResourceOwningPass(provenance.apiName, provenance.moduleSource) &&
          canDisposeThreePostprocessingResource(
            provenance.apiName,
            provenance.moduleSource,
            context,
          )
        ) {
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
            provenance && isThreeComposer(provenance.apiName, provenance.moduleSource),
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
