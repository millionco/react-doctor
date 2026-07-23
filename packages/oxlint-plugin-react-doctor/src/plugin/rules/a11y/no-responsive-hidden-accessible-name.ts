import { TAILWIND_BREAKPOINT_NAMES } from "../../constants/tailwind.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxPropExhaustiveStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";

interface ElementVisibilityEvidence {
  displayAtBreakpoints: ReadonlyArray<boolean>;
  hasGeneratedContent: boolean;
  isInert: boolean;
  visibilityOverridesAtBreakpoints: ReadonlyArray<boolean | null>;
}

interface ResponsiveVisibilityState {
  displayAtBreakpoints: ReadonlyArray<boolean>;
  visibilityAtBreakpoints: ReadonlyArray<boolean>;
}

interface ControlVisibilityEvidence extends ResponsiveVisibilityState {
  hasGeneratedContent: boolean;
}

interface TailwindClassVisibilityEvidence {
  displayAtBreakpoints: ReadonlyArray<boolean>;
  hasGeneratedContent: boolean;
  visibilityOverridesAtBreakpoints: ReadonlyArray<boolean | null>;
}

interface AccessibleNameEvidence {
  availabilityAtBreakpoints: boolean[];
  didFindContributor: boolean;
  isUnknown: boolean;
}

const CONTENT_NAMED_INTERACTIVE_TAGS = new Set(["a", "button"]);
const TAILWIND_DISPLAY_UTILITIES = new Set([
  "block",
  "contents",
  "flex",
  "flow-root",
  "grid",
  "hidden",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "inline-table",
  "list-item",
  "table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row",
  "table-row-group",
]);
const TAILWIND_VISIBILITY_UTILITIES = new Set(["collapse", "invisible", "visible"]);
const NON_CONTENT_NAME_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"];
const DESCENDANT_NATIVE_NAME_ATTRIBUTES = [
  ...NON_CONTENT_NAME_ATTRIBUTES,
  "alt",
  "placeholder",
  "value",
];
const OPAQUE_ACCESSIBLE_NAME_TAGS = new Set([
  "area",
  "audio",
  "canvas",
  "embed",
  "iframe",
  "img",
  "input",
  "math",
  "object",
  "script",
  "select",
  "slot",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

const resolveNonEmptyTextAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
  scopes: ScopeAnalysis,
): boolean | null => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return false;
  const values = getJsxPropExhaustiveStaticStringValues(attribute, scopes);
  if (!values) return null;
  return values.some((value) => value.trim().length > 0);
};

const resolveBooleanAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
  isHtmlBooleanAttribute: boolean,
): boolean | null => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) {
    if (isHtmlBooleanAttribute && typeof attribute.value.value === "string") return true;
    if (attribute.value.value === true || attribute.value.value === "true") return true;
    if (attribute.value.value === false || attribute.value.value === "false") return false;
    if (attribute.value.value === null) return false;
    return null;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = attribute.value.expression;
  if (isNullishExpression(expression)) return false;
  if (!isNodeOfType(expression, "Literal")) return null;
  if (isHtmlBooleanAttribute && typeof expression.value === "string") return true;
  if (expression.value === true || expression.value === "true") return true;
  if (expression.value === false || expression.value === "false") return false;
  return null;
};

const areVisibilityStatesEqual = (
  firstState: ReadonlyArray<boolean>,
  secondState: ReadonlyArray<boolean>,
): boolean =>
  firstState.length === secondState.length &&
  firstState.every((isVisible, breakpointIndex) => isVisible === secondState[breakpointIndex]);

const hasTailwindGeneratedContent = (className: string): boolean =>
  splitTailwindClassName(className)
    .map(parseTailwindClassNameToken)
    .some(({ utility }) => {
      const normalizedUtility = utility.toLowerCase();
      return normalizedUtility.startsWith("content-") || normalizedUtility.startsWith("[content:");
    });

const getResponsiveVariantApplicability = (
  variants: ReadonlyArray<string>,
): ReadonlyArray<boolean> | null => {
  let minimumBreakpointIndex = 0;
  let maximumBreakpointIndex = TAILWIND_BREAKPOINT_NAMES.length;
  for (const variant of variants) {
    const minimumVariantIndex = TAILWIND_BREAKPOINT_NAMES.indexOf(variant);
    if (minimumVariantIndex > 0) {
      minimumBreakpointIndex = Math.max(minimumBreakpointIndex, minimumVariantIndex);
      continue;
    }
    if (variant.startsWith("max-")) {
      const maximumVariantIndex = TAILWIND_BREAKPOINT_NAMES.indexOf(variant.slice("max-".length));
      if (maximumVariantIndex > 0) {
        maximumBreakpointIndex = Math.min(maximumBreakpointIndex, maximumVariantIndex);
        continue;
      }
    }
    return null;
  }
  return TAILWIND_BREAKPOINT_NAMES.map(
    (_, breakpointIndex) =>
      breakpointIndex >= minimumBreakpointIndex && breakpointIndex < maximumBreakpointIndex,
  );
};

const resolveTailwindClassVisibility = (
  className: string,
): TailwindClassVisibilityEvidence | null => {
  const rawTokens = splitTailwindClassName(className);
  const parsedTokens = rawTokens.map((rawToken) => ({
    parsedToken: parseTailwindClassNameToken(rawToken),
    rawToken,
  }));
  if (
    parsedTokens.some(({ parsedToken }) => {
      const normalizedUtility = parsedToken.utility.toLowerCase();
      return (
        normalizedUtility.startsWith("[display:") || normalizedUtility.startsWith("[visibility:")
      );
    })
  ) {
    return null;
  }
  for (const { parsedToken } of parsedTokens) {
    if (
      !TAILWIND_DISPLAY_UTILITIES.has(parsedToken.utility) &&
      !TAILWIND_VISIBILITY_UTILITIES.has(parsedToken.utility)
    ) {
      continue;
    }
    if (!getResponsiveVariantApplicability(parsedToken.variants)) return null;
  }
  if (!getTailwindVisibilityAtBreakpoints(className)) return null;
  const displayRawTokens: string[] = [];
  const visibilityTokens: typeof parsedTokens = [];
  for (const parsedToken of parsedTokens) {
    if (TAILWIND_VISIBILITY_UTILITIES.has(parsedToken.parsedToken.utility)) {
      visibilityTokens.push(parsedToken);
    } else {
      displayRawTokens.push(parsedToken.rawToken);
    }
  }
  const displayClassName = displayRawTokens.join(" ");
  const visibilityClassName = visibilityTokens.map(({ rawToken }) => rawToken).join(" ");
  const displayAtBreakpoints = getTailwindVisibilityAtBreakpoints(displayClassName);
  const visibilityAtBreakpoints = getTailwindVisibilityAtBreakpoints(visibilityClassName);
  if (!displayAtBreakpoints || !visibilityAtBreakpoints) return null;
  const hasVisibilityOverrideAtBreakpoints = TAILWIND_BREAKPOINT_NAMES.map(() => false);
  for (const { parsedToken } of visibilityTokens) {
    const applicability = getResponsiveVariantApplicability(parsedToken.variants);
    if (!applicability) return null;
    for (
      let breakpointIndex = 0;
      breakpointIndex < hasVisibilityOverrideAtBreakpoints.length;
      breakpointIndex += 1
    ) {
      hasVisibilityOverrideAtBreakpoints[breakpointIndex] =
        hasVisibilityOverrideAtBreakpoints[breakpointIndex] ||
        Boolean(applicability[breakpointIndex]);
    }
  }
  return {
    displayAtBreakpoints,
    hasGeneratedContent: hasTailwindGeneratedContent(className),
    visibilityOverridesAtBreakpoints: visibilityAtBreakpoints.map((isVisible, breakpointIndex) =>
      hasVisibilityOverrideAtBreakpoints[breakpointIndex] ? isVisible : null,
    ),
  };
};

const resolveSubtreeExclusion = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean | null => {
  if (hasJsxSpreadAttribute(openingElement.attributes)) return null;
  const hiddenState = resolveBooleanAttribute(openingElement, "hidden", true);
  const ariaHiddenState = resolveBooleanAttribute(openingElement, "aria-hidden", false);
  const inertState = resolveBooleanAttribute(openingElement, "inert", true);
  if (hiddenState === null || ariaHiddenState === null || inertState === null) return null;
  return hiddenState || ariaHiddenState || inertState;
};

const resolveElementVisibility = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): ElementVisibilityEvidence | null => {
  if (hasJsxSpreadAttribute(openingElement.attributes)) return null;
  if (getAuthoritativeJsxAttribute(openingElement.attributes, "class", false)) return null;
  if (getAuthoritativeJsxAttribute(openingElement.attributes, "style", false)) return null;
  const hiddenState = resolveBooleanAttribute(openingElement, "hidden", true);
  const ariaHiddenState = resolveBooleanAttribute(openingElement, "aria-hidden", false);
  const inertState = resolveBooleanAttribute(openingElement, "inert", true);
  if (hiddenState === null || ariaHiddenState === null || inertState === null) return null;

  const classNameAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "className",
    false,
  );
  const classNames = classNameAttribute
    ? getJsxPropExhaustiveStaticStringValues(classNameAttribute, scopes)
    : [""];
  if (!classNames || classNames.length === 0) return null;
  const candidateVisibilityStates = classNames.map(resolveTailwindClassVisibility);
  const firstVisibilityState = candidateVisibilityStates[0];
  if (
    !firstVisibilityState ||
    candidateVisibilityStates.some(
      (candidate) =>
        !candidate ||
        candidate.hasGeneratedContent !== firstVisibilityState.hasGeneratedContent ||
        !areVisibilityStatesEqual(
          firstVisibilityState.displayAtBreakpoints,
          candidate.displayAtBreakpoints,
        ) ||
        candidate.visibilityOverridesAtBreakpoints.some(
          (visibilityOverride, breakpointIndex) =>
            visibilityOverride !==
            firstVisibilityState.visibilityOverridesAtBreakpoints[breakpointIndex],
        ),
    )
  ) {
    return null;
  }
  const isStaticallyHidden = hiddenState || ariaHiddenState;
  return {
    displayAtBreakpoints: isStaticallyHidden
      ? firstVisibilityState.displayAtBreakpoints.map(() => false)
      : firstVisibilityState.displayAtBreakpoints,
    hasGeneratedContent: firstVisibilityState.hasGeneratedContent,
    isInert: inertState,
    visibilityOverridesAtBreakpoints: firstVisibilityState.visibilityOverridesAtBreakpoints,
  };
};

const combineVisibility = (
  inheritedVisibility: ResponsiveVisibilityState,
  ownVisibility: ElementVisibilityEvidence,
): ResponsiveVisibilityState => ({
  displayAtBreakpoints: inheritedVisibility.displayAtBreakpoints.map(
    (isAncestorDisplayed, breakpointIndex) =>
      isAncestorDisplayed && Boolean(ownVisibility.displayAtBreakpoints[breakpointIndex]),
  ),
  visibilityAtBreakpoints: inheritedVisibility.visibilityAtBreakpoints.map(
    (inheritedVisibilityState, breakpointIndex) =>
      ownVisibility.visibilityOverridesAtBreakpoints[breakpointIndex] ?? inheritedVisibilityState,
  ),
});

const getEffectiveVisibility = (visibility: ResponsiveVisibilityState): ReadonlyArray<boolean> =>
  visibility.displayAtBreakpoints.map(
    (isDisplayed, breakpointIndex) =>
      isDisplayed && Boolean(visibility.visibilityAtBreakpoints[breakpointIndex]),
  );

const hasPotentialNonContentName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeNames: ReadonlyArray<string>,
  scopes: ScopeAnalysis,
): boolean =>
  attributeNames.some(
    (attributeName) =>
      resolveNonEmptyTextAttribute(openingElement, attributeName, scopes) !== false,
  );

const resolveExactIntrinsicTagName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isProvenIntrinsicJsxElement(openingElement, scopes)) return null;
  const resolvedTagName = resolveJsxElementType(openingElement);
  return resolvedTagName === resolvedTagName.toLowerCase() ? resolvedTagName : null;
};

const isInsideOpaqueJsxCompositionBoundary = (
  element: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
): boolean => {
  let ancestor = element.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return true;
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      !resolveExactIntrinsicTagName(ancestor.openingElement, scopes)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const resolveImmutableStaticString = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? null;
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return resolveImmutableStaticString(symbol.initializer, scopes, nextVisitedSymbolIds);
};

const recordTextContributor = (
  visibilityAtBreakpoints: ReadonlyArray<boolean>,
  evidence: AccessibleNameEvidence,
): void => {
  evidence.didFindContributor = true;
  for (
    let breakpointIndex = 0;
    breakpointIndex < evidence.availabilityAtBreakpoints.length;
    breakpointIndex += 1
  ) {
    evidence.availabilityAtBreakpoints[breakpointIndex] =
      evidence.availabilityAtBreakpoints[breakpointIndex] ||
      Boolean(visibilityAtBreakpoints[breakpointIndex]);
  }
};

const collectAccessibleNameEvidence = (
  children: ReadonlyArray<EsTreeNode>,
  inheritedVisibility: ResponsiveVisibilityState,
  evidence: AccessibleNameEvidence,
  context: RuleContext,
): void => {
  for (const child of children) {
    if (evidence.isUnknown) return;
    if (isNodeOfType(child, "JSXText")) {
      if (child.value.trim().length > 0) {
        recordTextContributor(getEffectiveVisibility(inheritedVisibility), evidence);
      }
      continue;
    }
    if (isNodeOfType(child, "JSXExpressionContainer")) {
      const expression = stripParenExpression(child.expression);
      if (isNodeOfType(expression, "JSXEmptyExpression")) continue;
      if (isNullishExpression(expression)) continue;
      if (isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment")) {
        collectAccessibleNameEvidence([expression], inheritedVisibility, evidence, context);
        continue;
      }
      if (isNodeOfType(expression, "Literal")) {
        if (typeof expression.value === "boolean") continue;
        if (
          (typeof expression.value === "string" && expression.value.trim().length > 0) ||
          typeof expression.value === "number"
        ) {
          recordTextContributor(getEffectiveVisibility(inheritedVisibility), evidence);
          continue;
        }
      }
      const staticString = resolveImmutableStaticString(expression, context.scopes);
      if (staticString !== null) {
        if (staticString.trim().length > 0) {
          recordTextContributor(getEffectiveVisibility(inheritedVisibility), evidence);
        }
        continue;
      }
      evidence.isUnknown = true;
      return;
    }
    if (isNodeOfType(child, "JSXFragment")) {
      collectAccessibleNameEvidence(child.children, inheritedVisibility, evidence, context);
      continue;
    }
    if (!isNodeOfType(child, "JSXElement")) {
      evidence.isUnknown = true;
      return;
    }

    const openingElement = child.openingElement;
    const tagName = resolveExactIntrinsicTagName(openingElement, context.scopes);
    if (!tagName) {
      evidence.isUnknown = true;
      return;
    }
    const subtreeExclusion = resolveSubtreeExclusion(openingElement);
    if (subtreeExclusion === null) {
      evidence.isUnknown = true;
      return;
    }
    if (subtreeExclusion) continue;
    if (
      OPAQUE_ACCESSIBLE_NAME_TAGS.has(tagName) ||
      isInteractiveElement(tagName, openingElement) ||
      hasPotentialNonContentName(
        openingElement,
        DESCENDANT_NATIVE_NAME_ATTRIBUTES,
        context.scopes,
      ) ||
      getAuthoritativeJsxAttribute(openingElement.attributes, "role", false)
    ) {
      evidence.isUnknown = true;
      return;
    }
    const visibilityEvidence = resolveElementVisibility(openingElement, context.scopes);
    if (
      !visibilityEvidence ||
      visibilityEvidence.isInert ||
      visibilityEvidence.hasGeneratedContent
    ) {
      evidence.isUnknown = true;
      return;
    }
    collectAccessibleNameEvidence(
      child.children,
      combineVisibility(inheritedVisibility, visibilityEvidence),
      evidence,
      context,
    );
  }
};

const resolveControlVisibility = (
  controlElement: EsTreeNodeOfType<"JSXElement">,
  controlTagName: string,
  context: RuleContext,
): ControlVisibilityEvidence | null => {
  const elementChain: Array<EsTreeNodeOfType<"JSXElement">> = [];
  const enclosingFunction = context.cfg.enclosingFunction(controlElement);
  let current: EsTreeNode | null | undefined = controlElement;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      elementChain.push(current);
    } else if (
      isNodeOfType(current, "JSXExpressionContainer") ||
      isNodeOfType(current, "LogicalExpression") ||
      isNodeOfType(current, "ConditionalExpression") ||
      isNodeOfType(current, "ArrayExpression") ||
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(current.type)
    ) {
      current = current.parent;
      continue;
    } else if (isNodeOfType(current, "ReturnStatement")) {
      break;
    } else if (current === enclosingFunction && isNodeOfType(current, "ArrowFunctionExpression")) {
      if (
        !isNodeOfType(current.parent, "VariableDeclarator") &&
        !isNodeOfType(current.parent, "ExportDefaultDeclaration")
      ) {
        return null;
      }
      break;
    } else if (!isNodeOfType(current, "JSXFragment")) {
      return null;
    }
    current = current.parent;
  }
  let combinedVisibility: ResponsiveVisibilityState = {
    displayAtBreakpoints: TAILWIND_BREAKPOINT_NAMES.map(() => true),
    visibilityAtBreakpoints: TAILWIND_BREAKPOINT_NAMES.map(() => true),
  };
  let hasGeneratedContent = false;
  for (const element of elementChain.reverse()) {
    const openingElement = element.openingElement;
    const tagName = resolveExactIntrinsicTagName(openingElement, context.scopes);
    if (!tagName || (element !== controlElement && tagName === "label")) return null;
    if (controlTagName === "button" && element !== controlElement && tagName === "fieldset") {
      const fieldsetDisabledState = resolveBooleanAttribute(openingElement, "disabled", true);
      if (fieldsetDisabledState !== false) return null;
    }
    const visibilityEvidence = resolveElementVisibility(openingElement, context.scopes);
    if (!visibilityEvidence || visibilityEvidence.isInert) return null;
    combinedVisibility = combineVisibility(combinedVisibility, visibilityEvidence);
    if (element === controlElement) {
      hasGeneratedContent = visibilityEvidence.hasGeneratedContent;
    }
  }
  return {
    ...combinedVisibility,
    hasGeneratedContent,
  };
};

const hasProvenInteractiveSemantics = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  tagName: string,
  context: RuleContext,
): boolean => {
  if (!CONTENT_NAMED_INTERACTIVE_TAGS.has(tagName)) return false;
  if (!isInteractiveElement(tagName, openingElement)) return false;
  if (getAuthoritativeJsxAttribute(openingElement.attributes, "role", false)) return false;
  if (tagName === "button") {
    const disabledState = resolveBooleanAttribute(openingElement, "disabled", true);
    if (disabledState !== false) return false;
  }
  if (tagName !== "a") return true;
  const hrefState = resolveNonEmptyTextAttribute(openingElement, "href", context.scopes);
  return hrefState === true;
};

export const noResponsiveHiddenAccessibleName = defineRule({
  id: "no-responsive-hidden-accessible-name",
  title: "Responsive styles hide a control's accessible name",
  severity: "warn",
  category: "Accessibility",
  tags: ["react-jsx-only"],
  recommendation:
    "Keep an accessible name available at every breakpoint, such as persistent sr-only text or an aria-label on the control.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!hasCapabilityOrUnspecified(context.settings, "tailwind")) return;
      const openingElement = node.openingElement;
      if (hasJsxSpreadAttribute(openingElement.attributes)) return;
      if (isInsideOpaqueJsxCompositionBoundary(node, context.scopes)) return;
      const tagName = resolveExactIntrinsicTagName(openingElement, context.scopes);
      if (!tagName) return;
      if (!hasProvenInteractiveSemantics(openingElement, tagName, context)) return;
      if (
        hasPotentialNonContentName(openingElement, NON_CONTENT_NAME_ATTRIBUTES, context.scopes) ||
        hasPotentialNonContentName(openingElement, ["id"], context.scopes) ||
        getAuthoritativeJsxAttribute(openingElement.attributes, "children", false) ||
        getAuthoritativeJsxAttribute(openingElement.attributes, "dangerouslySetInnerHTML", false)
      ) {
        return;
      }
      const controlVisibility = resolveControlVisibility(node, tagName, context);
      if (!controlVisibility || controlVisibility.hasGeneratedContent) return;
      const effectiveControlVisibility = getEffectiveVisibility(controlVisibility);
      const evidence: AccessibleNameEvidence = {
        availabilityAtBreakpoints: effectiveControlVisibility.map(() => false),
        didFindContributor: false,
        isUnknown: false,
      };
      collectAccessibleNameEvidence(node.children, controlVisibility, evidence, context);
      if (evidence.isUnknown || !evidence.didFindContributor) return;
      const hasNamedVisibleBreakpoint = evidence.availabilityAtBreakpoints.some(Boolean);
      const hasVisibleUnnamedBreakpoint = effectiveControlVisibility.some(
        (isControlVisible, breakpointIndex) =>
          isControlVisible && !evidence.availabilityAtBreakpoints[breakpointIndex],
      );
      if (!hasNamedVisibleBreakpoint || !hasVisibleUnnamedBreakpoint) return;
      context.report({
        node: openingElement,
        message:
          "This control stays visible at a responsive breakpoint after all of its accessible-name content is hidden. Keep a screen-reader-readable name available at every breakpoint.",
      });
    },
  }),
});
