import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isInsideStableReactInitializer } from "../../utils/is-inside-stable-react-initializer.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

export const threeNoObjectConstructionInRender = defineRule({
  id: "three-no-object-construction-in-render",
  title: "Three.js object constructed during React render",
  severity: "warn",
  recommendation:
    "Construct mutable Three.js objects in a stable initializer, effect, event, or module scope instead of recreating them during React render",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        !provenance ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !findRenderPhaseComponentOrHook(node, context.scopes) ||
        isInsideStableReactInitializer(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: `new ${provenance.apiName}() creates a fresh mutable Three.js object during this render. Preserve it with useMemo, useState, useRef, or module scope`,
      });
    },
  }),
});
