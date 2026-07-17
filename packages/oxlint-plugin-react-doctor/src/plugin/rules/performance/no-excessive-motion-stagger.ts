import { EXCESSIVE_MOTION_STAGGER_SECONDS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticMotionTransitionObjects } from "../../utils/get-static-motion-transition-objects.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStylePropertyNumberValue } from "../design/utils/get-style-property-number-value.js";

const MOTION_MODULES = new Set(["framer-motion", "motion/react"]);

const isMotionStaggerCall = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier")) {
    return false;
  }
  const symbol = resolveConstIdentifierAlias(node.callee, context.scopes);
  if (
    symbol?.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    getImportedName(symbol.declarationNode) !== "stagger"
  ) {
    return false;
  }
  const declaration = symbol.declarationNode.parent;
  return Boolean(
    declaration &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    typeof declaration.source.value === "string" &&
    MOTION_MODULES.has(declaration.source.value),
  );
};

const getStaggerSeconds = (
  transitionObject: EsTreeNodeOfType<"ObjectExpression">,
  context: RuleContext,
): { node: EsTreeNode; seconds: number } | null => {
  const legacyProperty = getEffectiveStyleProperty(transitionObject.properties, "staggerChildren");
  const legacySeconds = legacyProperty ? getStylePropertyNumberValue(legacyProperty) : null;
  if (legacyProperty && legacySeconds !== null) {
    return { node: legacyProperty, seconds: legacySeconds };
  }
  const delayChildrenProperty = getEffectiveStyleProperty(
    transitionObject.properties,
    "delayChildren",
  );
  if (
    !delayChildrenProperty ||
    !isNodeOfType(delayChildrenProperty, "Property") ||
    !isNodeOfType(delayChildrenProperty.value, "CallExpression") ||
    !isMotionStaggerCall(delayChildrenProperty.value, context)
  ) {
    return null;
  }
  const intervalArgument = delayChildrenProperty.value.arguments[0];
  if (
    !intervalArgument ||
    !isNodeOfType(intervalArgument, "Literal") ||
    typeof intervalArgument.value !== "number"
  ) {
    return null;
  }
  return { node: delayChildrenProperty, seconds: intervalArgument.value };
};

export const noExcessiveMotionStagger = defineRule({
  id: "no-excessive-motion-stagger",
  title: "Motion child stagger is too long",
  severity: "warn",
  category: "Performance",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Keep per-item stagger intervals short so later content does not feel artificially delayed.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const transitionObject of getStaticMotionTransitionObjects(node, context.scopes)) {
        const stagger = getStaggerSeconds(transitionObject, context);
        if (!stagger || stagger.seconds <= EXCESSIVE_MOTION_STAGGER_SECONDS) continue;
        context.report({
          node: stagger.node,
          message: `This ${stagger.seconds}-second per-item stagger makes later children wait unnecessarily. Keep the interval at ${EXCESSIVE_MOTION_STAGGER_SECONDS} seconds or less.`,
        });
      }
    },
  }),
});
