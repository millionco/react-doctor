import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { doesTailwindVariantScopeCover } from "../../utils/does-tailwind-variant-scope-cover.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getTailwindTransitionAllState } from "../../utils/get-tailwind-transition-all-state.js";
import { hasImportantTailwindClassNameToken } from "../../utils/has-important-tailwind-class-name-token.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveTailwindBooleanPropertyState } from "../../utils/resolve-tailwind-boolean-property-state.js";
import { resolveTailwindTransitionDurationState } from "../../utils/resolve-tailwind-transition-duration-state.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveCssTransitionEvidence } from "../design/utils/get-effective-css-transition-evidence.js";
import { getInlineStyleExpression } from "../design/utils/get-inline-style-expression.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const ALL_TRANSITION_PROPERTY_NAMES = new Set(["all"]);

const isTransitionDurationSetter = (utility: string): boolean =>
  !utility.startsWith("[transition-property:") &&
  (utility.startsWith("duration-") ||
    utility.startsWith("[transition-duration:") ||
    utility.startsWith("[transition:") ||
    getTailwindTransitionAllState(utility) !== null);

const hasTransitionAllClass = (classNameValue: string): boolean => {
  const parsedTokens = splitTailwindClassName(classNameValue).map(parseTailwindClassNameToken);
  return parsedTokens.some(
    (parsedToken) =>
      resolveTailwindBooleanPropertyState(
        parsedTokens,
        parsedToken.variants,
        getTailwindTransitionAllState,
      ) === true &&
      resolveTailwindTransitionDurationState(
        parsedTokens,
        parsedToken.variants,
        ALL_TRANSITION_PROPERTY_NAMES,
      ) === true,
  );
};

const hasMergedTransitionAll = (
  classNameValue: string,
  styleAttribute: EsTreeNodeOfType<"JSXAttribute"> | null,
  reportNode: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const parsedTokens = splitTailwindClassName(classNameValue).map(parseTailwindClassNameToken);
  const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute, scopes) : null;
  if (styleAttribute && !styleExpression) return false;
  const variantScopes = [[], ...parsedTokens.map((parsedToken) => parsedToken.variants)];
  return variantScopes.some((variantScope) => {
    const hasApplicablePropertySetter = parsedTokens.some(
      (parsedToken) =>
        getTailwindTransitionAllState(parsedToken.utility) !== null &&
        doesTailwindVariantScopeCover(parsedToken.variants, variantScope),
    );
    const transitionAllState = resolveTailwindBooleanPropertyState(
      parsedTokens,
      variantScope,
      getTailwindTransitionAllState,
    );
    const durationState = resolveTailwindTransitionDurationState(
      parsedTokens,
      variantScope,
      ALL_TRANSITION_PROPERTY_NAMES,
    );
    const hasImportantTransitionProperty = hasImportantTailwindClassNameToken(
      parsedTokens,
      variantScope,
      (utility) => getTailwindTransitionAllState(utility) !== null,
    );
    const hasImportantTransitionDuration = hasImportantTailwindClassNameToken(
      parsedTokens,
      variantScope,
      isTransitionDurationSetter,
    );
    const transitionEvidence = getEffectiveCssTransitionEvidence(
      styleExpression?.properties,
      [
        {
          hasPositiveDuration: durationState === true,
          propertyName:
            !hasApplicablePropertySetter || transitionAllState === true ? "all" : "opacity",
          sourceNode: reportNode,
        },
      ],
      {
        duration: hasImportantTransitionDuration,
        property: hasImportantTransitionProperty,
      },
    );
    return transitionEvidence?.some(
      (transition) => transition.propertyName === "all" && transition.durationMilliseconds > 0,
    );
  });
};

const TAILWIND_MESSAGE =
  "Your users see janky animation because `transition-all` animates every property that changes, including expensive layout ones and instant ones like focus rings. Name the properties: `transition-colors`, `transition-opacity`, or `transition-transform`.";

export const noTransitionAll = defineRule({
  id: "no-transition-all",
  title: "transition: all animates everything",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    'List the specific properties: `transition: "opacity 200ms, transform 200ms"`. In Tailwind, use `transition-colors`, `transition-opacity`, or `transition-transform`',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
      const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className");
      const classNameValues =
        hasTailwind && classNameAttribute
          ? getJsxPropStaticStringValues(classNameAttribute, context.scopes)
          : [""];
      if (!classNameValues) return;
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      if (
        !classNameValues.some((classNameValue) =>
          hasMergedTransitionAll(classNameValue, styleAttribute, node, context.scopes),
        )
      )
        return;
      context.report({
        node,
        message: classNameValues.some(hasTransitionAllClass)
          ? TAILWIND_MESSAGE
          : 'This can stutter because transition: "all" animates every property, even slow layout ones, so list only the properties you actually change',
      });
    },
  }),
});
