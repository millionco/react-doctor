import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { createRemotionRenderEvidenceChecker } from "./create-remotion-render-evidence-checker.js";
import { findRenderPhaseComponentOrHook } from "./find-render-phase-component-or-hook.js";
import { getJsxAttributeStaticString } from "./get-jsx-attribute-static-string.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import type { RuleVisitors } from "./rule-visitors.js";

export interface RemotionCssTimeRuleOptions {
  classTokenIsForbidden: (classToken: string) => boolean;
  classMessage: string;
  styleMessage: string;
  stylePropertyNames: ReadonlySet<string>;
}

export const createRemotionCssTimeRuleVisitors = (
  context: RuleContext,
  options: RemotionCssTimeRuleOptions,
): RuleVisitors => {
  const renderEvidence = createRemotionRenderEvidenceChecker(context);
  return {
    Property(node: EsTreeNodeOfType<"Property">) {
      if (!options.stylePropertyNames.has(getStaticPropertyKeyName(node) ?? "")) {
        return;
      }
      const styleObject = node.parent;
      const expressionContainer = styleObject?.parent;
      const styleAttribute = expressionContainer?.parent;
      if (
        !isNodeOfType(styleObject, "ObjectExpression") ||
        !isNodeOfType(expressionContainer, "JSXExpressionContainer") ||
        expressionContainer.expression !== styleObject ||
        !isNodeOfType(styleAttribute, "JSXAttribute") ||
        !isNodeOfType(styleAttribute.name, "JSXIdentifier") ||
        styleAttribute.name.name !== "style"
      ) {
        return;
      }
      const renderFunction = findRenderPhaseComponentOrHook(node, context.scopes);
      if (!renderFunction || !renderEvidence.functionHasEvidence(renderFunction)) return;
      context.report({ node, message: options.styleMessage });
    },
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "className") {
        return;
      }
      const renderFunction = findRenderPhaseComponentOrHook(node, context.scopes);
      if (!renderFunction || !renderEvidence.functionHasEvidence(renderFunction)) return;
      const className = getJsxAttributeStaticString(node);
      if (!className) return;
      const hasForbiddenClass = className
        .split(/\s+/)
        .filter(Boolean)
        .some((classToken) => options.classTokenIsForbidden(classToken.split(":").at(-1) ?? ""));
      if (hasForbiddenClass) context.report({ node, message: options.classMessage });
    },
  };
};
