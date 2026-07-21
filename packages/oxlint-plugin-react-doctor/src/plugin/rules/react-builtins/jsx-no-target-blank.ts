import { defineRule } from "../../utils/define-rule.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasPossibleStaticPropertyMutationOrEscapeBefore } from "../../utils/has-static-property-write-before.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const NOREFERRER_MESSAGE =
  '`target="_blank"` without `rel="noreferrer"` lets the linked page hijack your tab to a phishing site.';
const NOOPENER_MESSAGE =
  '`target="_blank"` without `noopener` or `noreferrer` in `rel` lets the linked page hijack your tab to a phishing site.';
const SPREAD_MESSAGE =
  'A spread here can add `target="_blank"`, letting the linked page hijack your tab to a phishing site.';

interface JsxNoTargetBlankSettings {
  enforceDynamicLinks?: "always" | "never";
  warnOnSpreadAttributes?: boolean;
  allowReferrer?: boolean;
  links?: boolean;
  forms?: boolean;
}

interface ReactSettings {
  linkComponents?: ReadonlyArray<
    string | { name: string; linkAttribute?: string | ReadonlyArray<string> }
  >;
  formComponents?: ReadonlyArray<
    string | { name: string; formAttribute?: string | ReadonlyArray<string> }
  >;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): {
  enforceDynamicLinks: "always" | "never";
  warnOnSpreadAttributes: boolean;
  allowReferrer: boolean;
  links: boolean;
  forms: boolean;
  linkComponents: Map<string, ReadonlyArray<string>>;
  formComponents: Map<string, ReadonlyArray<string>>;
} => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxNoTargetBlank?: JsxNoTargetBlankSettings }).jsxNoTargetBlank ?? {})
      : {};
  const reactSettings =
    typeof settings?.react === "object" && settings.react !== null
      ? (settings.react as ReactSettings)
      : {};
  const linkComponents = new Map<string, ReadonlyArray<string>>();
  for (const entry of reactSettings.linkComponents ?? []) {
    if (typeof entry === "string") {
      linkComponents.set(entry, ["href"]);
    } else if (typeof entry === "object" && entry !== null) {
      const linkAttribute = entry.linkAttribute ?? "href";
      linkComponents.set(
        entry.name,
        Array.isArray(linkAttribute) ? linkAttribute : [linkAttribute],
      );
    }
  }
  const formComponents = new Map<string, ReadonlyArray<string>>();
  for (const entry of reactSettings.formComponents ?? []) {
    if (typeof entry === "string") {
      formComponents.set(entry, ["action"]);
    } else if (typeof entry === "object" && entry !== null) {
      const formAttribute = entry.formAttribute ?? "action";
      formComponents.set(
        entry.name,
        Array.isArray(formAttribute) ? formAttribute : [formAttribute],
      );
    }
  }
  return {
    enforceDynamicLinks: ruleSettings.enforceDynamicLinks ?? "always",
    warnOnSpreadAttributes: ruleSettings.warnOnSpreadAttributes ?? false,
    allowReferrer:
      ruleSettings.allowReferrer ??
      (hasCapability(settings, "target-blank-needs-explicit-protection") &&
        !hasCapability(settings, "target-blank-needs-noreferrer")),
    links: ruleSettings.links ?? true,
    forms: ruleSettings.forms ?? false,
    linkComponents,
    formComponents,
  };
};

interface BranchTuple {
  combined: boolean;
  isComplete: boolean;
  testKey: string;
  consequent: boolean;
  alternate: boolean;
}

interface ConditionalPredicate {
  isNegated: boolean;
  key: string;
}

interface DestinationState {
  hasValue: boolean;
  isAuthoritative: boolean;
  isValid: boolean;
}

const EXTERNAL_LINK_PATTERN = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

const isExternalLink = (href: string): boolean => EXTERNAL_LINK_PATTERN.test(href);

const matchHrefExpression = (
  expression: EsTreeNode,
  state: { isExternal: boolean; isDynamic: boolean },
  scopes: RuleContext["scopes"],
): void => {
  const resolvedExpression = resolveConstExpression(expression, scopes);
  if (isNodeOfType(resolvedExpression, "Literal")) {
    if (typeof resolvedExpression.value === "string" && isExternalLink(resolvedExpression.value)) {
      state.isExternal = true;
    }
    return;
  }
  if (isNodeOfType(resolvedExpression, "TemplateLiteral")) {
    if (resolvedExpression.expressions.length > 0) {
      state.isDynamic = true;
      return;
    }
    const staticText =
      resolvedExpression.quasis[0]?.value.cooked ?? resolvedExpression.quasis[0]?.value.raw ?? "";
    if (isExternalLink(staticText)) state.isExternal = true;
    return;
  }
  if (isNodeOfType(resolvedExpression, "ConditionalExpression")) {
    matchHrefExpression(resolvedExpression.consequent, state, scopes);
    matchHrefExpression(resolvedExpression.alternate, state, scopes);
    return;
  }
  state.isDynamic = true;
};

const checkHref = (
  attributeValue: EsTreeNode,
  enforceDynamicLinks: "always" | "never",
  scopes: RuleContext["scopes"],
): boolean => {
  const state = { isExternal: false, isDynamic: false };
  if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
    state.isExternal = isExternalLink(attributeValue.value);
  } else if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    matchHrefExpression(attributeValue.expression, state, scopes);
  } else {
    matchHrefExpression(attributeValue, state, scopes);
  }
  if (enforceDynamicLinks === "never") {
    return !state.isExternal || state.isDynamic;
  }
  return !(state.isExternal || state.isDynamic);
};

const checkRelValue = (text: string, allowReferrer: boolean): boolean => {
  const tokens = text.split(/\s+/).map((token) => token.toLowerCase());
  if (allowReferrer) {
    return tokens.includes("noopener") || tokens.includes("noreferrer");
  }
  return tokens.includes("noreferrer");
};

const resolveConstExpression = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
  visitedSymbolIds = new Set<number>(),
): EsTreeNode => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return unwrappedExpression;
  const symbol = scopes.symbolFor(unwrappedExpression);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return unwrappedExpression;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveConstExpression(symbol.initializer, scopes, visitedSymbolIds);
};

const resolveConditionalPredicate = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
  visitedSymbolIds = new Set<number>(),
): ConditionalPredicate | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const predicate = resolveConditionalPredicate(
      unwrappedExpression.argument,
      scopes,
      visitedSymbolIds,
    );
    return predicate ? { ...predicate, isNegated: !predicate.isNegated } : null;
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = scopes.symbolFor(unwrappedExpression);
  if (!symbol) {
    return { isNegated: false, key: `unresolved:${unwrappedExpression.name}` };
  }
  if (symbol.references.some((reference) => reference.flag !== "read")) return null;
  if (
    symbol.kind === "const" &&
    symbol.initializer &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    !visitedSymbolIds.has(symbol.id)
  ) {
    const initializer = stripParenExpression(symbol.initializer);
    if (
      isNodeOfType(initializer, "Identifier") ||
      (isNodeOfType(initializer, "UnaryExpression") && initializer.operator === "!")
    ) {
      visitedSymbolIds.add(symbol.id);
      const predicate = resolveConditionalPredicate(initializer, scopes, visitedSymbolIds);
      visitedSymbolIds.delete(symbol.id);
      if (predicate) return predicate;
    }
  }
  return { isNegated: false, key: `symbol:${String(symbol.id)}` };
};

const emptyBranchTuple = (): BranchTuple => ({
  alternate: false,
  combined: false,
  consequent: false,
  isComplete: false,
  testKey: "",
});

const matchRelExpression = (
  expression: EsTreeNode,
  allowReferrer: boolean,
  scopes: RuleContext["scopes"],
): BranchTuple => {
  const empty = emptyBranchTuple();
  const resolvedExpression = resolveConstExpression(expression, scopes);
  if (isNodeOfType(resolvedExpression, "Literal") && typeof resolvedExpression.value === "string") {
    return {
      combined: checkRelValue(resolvedExpression.value, allowReferrer),
      isComplete: true,
      testKey: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(resolvedExpression, "TemplateLiteral")) {
    if (resolvedExpression.expressions.length > 0) return empty;
    const staticText =
      resolvedExpression.quasis[0]?.value.cooked ?? resolvedExpression.quasis[0]?.value.raw ?? "";
    return {
      combined: checkRelValue(staticText, allowReferrer),
      isComplete: true,
      testKey: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(resolvedExpression, "ConditionalExpression")) {
    const consequent = matchRelExpression(resolvedExpression.consequent, allowReferrer, scopes);
    const alternate = matchRelExpression(resolvedExpression.alternate, allowReferrer, scopes);
    const predicate = resolveConditionalPredicate(resolvedExpression.test, scopes);
    if (predicate) {
      return {
        combined: consequent.combined && alternate.combined,
        isComplete: consequent.isComplete && alternate.isComplete,
        testKey: predicate.key,
        consequent: predicate.isNegated ? alternate.combined : consequent.combined,
        alternate: predicate.isNegated ? consequent.combined : alternate.combined,
      };
    }
    return {
      combined: consequent.combined && alternate.combined,
      isComplete: consequent.isComplete && alternate.isComplete,
      testKey: "",
      consequent: consequent.combined,
      alternate: alternate.combined,
    };
  }
  return empty;
};

const checkRel = (
  attributeValue: EsTreeNode,
  allowReferrer: boolean,
  scopes: RuleContext["scopes"],
): BranchTuple => {
  const empty = emptyBranchTuple();
  if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
    return {
      combined: checkRelValue(attributeValue.value, allowReferrer),
      isComplete: true,
      testKey: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression;
    if (expression.type === "JSXEmptyExpression") return empty;
    return matchRelExpression(expression, allowReferrer, scopes);
  }
  return matchRelExpression(attributeValue, allowReferrer, scopes);
};

const matchTargetExpression = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
): BranchTuple => {
  const empty = emptyBranchTuple();
  const resolvedExpression = resolveConstExpression(expression, scopes);
  if (
    isNodeOfType(resolvedExpression, "Identifier") &&
    resolvedExpression.name === "undefined" &&
    !scopes.symbolFor(resolvedExpression)
  ) {
    return { ...empty, isComplete: true };
  }
  if (
    isNodeOfType(resolvedExpression, "UnaryExpression") &&
    resolvedExpression.operator === "void"
  ) {
    return { ...empty, isComplete: true };
  }
  if (isNodeOfType(resolvedExpression, "Literal")) {
    return {
      combined:
        typeof resolvedExpression.value === "string" &&
        resolvedExpression.value.toLowerCase() === "_blank",
      isComplete: true,
      testKey: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(resolvedExpression, "TemplateLiteral")) {
    if (resolvedExpression.expressions.length > 0) return empty;
    const staticText =
      resolvedExpression.quasis[0]?.value.cooked ?? resolvedExpression.quasis[0]?.value.raw ?? "";
    return {
      combined: staticText.toLowerCase() === "_blank",
      isComplete: true,
      testKey: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(resolvedExpression, "ConditionalExpression")) {
    const consequent = matchTargetExpression(resolvedExpression.consequent, scopes);
    const alternate = matchTargetExpression(resolvedExpression.alternate, scopes);
    const combined = consequent.combined || alternate.combined;
    const predicate = resolveConditionalPredicate(resolvedExpression.test, scopes);
    if (predicate) {
      return {
        combined,
        isComplete: consequent.isComplete && alternate.isComplete,
        testKey: predicate.key,
        consequent: predicate.isNegated ? alternate.combined : consequent.combined,
        alternate: predicate.isNegated ? consequent.combined : alternate.combined,
      };
    }
    return {
      combined,
      isComplete: consequent.isComplete && alternate.isComplete,
      testKey: "",
      consequent: consequent.combined,
      alternate: alternate.combined,
    };
  }
  return empty;
};

const checkTarget = (attributeValue: EsTreeNode, scopes: RuleContext["scopes"]): BranchTuple => {
  if (isNodeOfType(attributeValue, "Literal")) {
    return {
      combined:
        typeof attributeValue.value === "string" && attributeValue.value.toLowerCase() === "_blank",
      isComplete: true,
      testKey: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression;
    if (expression.type === "JSXEmptyExpression") {
      return { ...emptyBranchTuple(), isComplete: true };
    }
    return matchTargetExpression(expression, scopes);
  }
  return matchTargetExpression(attributeValue, scopes);
};

const visitStaticSpreadProperties = (
  expression: EsTreeNode,
  scopes: RuleContext["scopes"],
  observedPropertyNames: ReadonlySet<string>,
  visitProperty: (
    propertyName: string,
    propertyValue: EsTreeNode,
    propertyNode: EsTreeNode,
  ) => void,
  visitUnknown: () => void,
  visitedSymbolIds = new Set<number>(),
): void => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      visitedSymbolIds.has(symbol.id) ||
      [...observedPropertyNames].some((propertyName) =>
        hasPossibleStaticPropertyMutationOrEscapeBefore(
          unwrappedExpression,
          propertyName,
          expression,
          scopes,
        ),
      )
    ) {
      visitUnknown();
      return;
    }
    visitedSymbolIds.add(symbol.id);
    visitStaticSpreadProperties(
      symbol.initializer,
      scopes,
      observedPropertyNames,
      visitProperty,
      visitUnknown,
      visitedSymbolIds,
    );
    visitedSymbolIds.delete(symbol.id);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "Literal")) return;
  if (!isNodeOfType(unwrappedExpression, "ObjectExpression")) {
    visitUnknown();
    return;
  }
  for (const property of unwrappedExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      visitStaticSpreadProperties(
        property.argument,
        scopes,
        observedPropertyNames,
        visitProperty,
        visitUnknown,
        visitedSymbolIds,
      );
      continue;
    }
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method) {
      visitUnknown();
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) {
      visitUnknown();
      continue;
    }
    visitProperty(propertyName, property.value, property);
  }
};

// Port of `oxc_linter::rules::react::jsx_no_target_blank`.
export const jsxNoTargetBlank = defineRule({
  id: "jsx-no-target-blank",
  title: "Unsafe target=_blank link",
  severity: "warn",
  recommendation: 'Add `rel="noreferrer"` (or `"noopener"`) when using `target="_blank"`.',
  category: "Security",
  requires: ["target-blank-needs-explicit-protection"],
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isLink = (tagName: string): boolean => {
      if (!settings.links) return false;
      if (tagName === "a") return true;
      return settings.linkComponents.has(tagName);
    };
    const isForm = (tagName: string): boolean => {
      if (!settings.forms) return false;
      if (tagName === "form") return true;
      return settings.formComponents.has(tagName);
    };
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const tagName = resolveJsxElementType(node);
        if (!tagName) return;
        const tagIsLink = isLink(tagName);
        const tagIsForm = isForm(tagName);
        if (!tagIsLink && !tagIsForm) return;

        const linkAttributeNames =
          tagName === "a" ? ["href"] : (settings.linkComponents.get(tagName) ?? []);
        const formAttributeNames =
          tagName === "form" ? ["action"] : (settings.formComponents.get(tagName) ?? []);
        const destinationAttributeNames = new Set([
          ...(tagIsLink ? linkAttributeNames : []),
          ...(tagIsForm ? formAttributeNames : []),
        ]);
        const observedPropertyNames = new Set([...destinationAttributeNames, "target", "rel"]);
        const destinations = new Map<string, DestinationState>();
        for (const destinationAttributeName of destinationAttributeNames) {
          destinations.set(destinationAttributeName, {
            hasValue: false,
            isAuthoritative: true,
            isValid: true,
          });
        }

        let targetTuple: BranchTuple = {
          combined: false,
          isComplete: false,
          testKey: "",
          consequent: false,
          alternate: false,
        };
        let relTuple: BranchTuple = {
          combined: false,
          isComplete: false,
          testKey: "",
          consequent: false,
          alternate: false,
        };
        let warnSpread = false;
        let targetReportNode: EsTreeNode = node.name as EsTreeNode;
        let spreadReportNode: EsTreeNode | null = null;
        let isTargetAuthoritative = true;
        let isRelAuthoritative = true;

        const applyProperty = (
          propertyName: string,
          propertyValue: EsTreeNode | null,
          propertyNode: EsTreeNode,
        ): void => {
          if (propertyName === "target") {
            isTargetAuthoritative = true;
            targetTuple = propertyValue
              ? checkTarget(propertyValue, context.scopes)
              : { ...emptyBranchTuple(), isComplete: true };
            targetReportNode = propertyNode;
            if (targetTuple.isComplete && !targetTuple.combined) {
              warnSpread = false;
              spreadReportNode = null;
            }
            return;
          }
          if (destinationAttributeNames.has(propertyName)) {
            destinations.set(propertyName, {
              hasValue: true,
              isAuthoritative: true,
              isValid: propertyValue
                ? checkHref(propertyValue, settings.enforceDynamicLinks, context.scopes)
                : true,
            });
            return;
          }
          if (propertyName === "rel") {
            isRelAuthoritative = true;
            relTuple = propertyValue
              ? checkRel(propertyValue, settings.allowReferrer, context.scopes)
              : { ...emptyBranchTuple(), isComplete: true };
          }
        };

        const applyUnknownSpread = (spreadNode: EsTreeNode): void => {
          isTargetAuthoritative = false;
          isRelAuthoritative = false;
          for (const destination of destinations.values()) {
            destination.isAuthoritative = false;
          }
          if (!settings.warnOnSpreadAttributes) return;
          warnSpread = true;
          spreadReportNode = spreadNode;
          targetTuple = emptyBranchTuple();
          relTuple = emptyBranchTuple();
        };

        for (const attribute of node.attributes) {
          if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
            visitStaticSpreadProperties(
              attribute.argument,
              context.scopes,
              observedPropertyNames,
              applyProperty,
              () => applyUnknownSpread(attribute),
            );
            continue;
          }
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const attributeName = attribute.name;
          if (!isNodeOfType(attributeName, "JSXIdentifier")) continue;
          const propName = attributeName.name;
          const value = attribute.value;
          applyProperty(propName, value, value ?? attribute);
        }

        if (warnSpread) {
          const allDestinationsProvenSafe = [...destinations.values()].every(
            (destination) => destination.isAuthoritative && destination.isValid,
          );
          if (allDestinationsProvenSafe || relTuple.combined) return;
          context.report({ node: spreadReportNode ?? node, message: SPREAD_MESSAGE });
          return;
        }

        const hasUnsafeAuthoritativeDestination = [...destinations.values()].some(
          (destination) =>
            destination.hasValue && destination.isAuthoritative && !destination.isValid,
        );

        if (hasUnsafeAuthoritativeDestination && isTargetAuthoritative && isRelAuthoritative) {
          if (targetTuple.testKey !== "" && targetTuple.testKey === relTuple.testKey) {
            const consequentBad = targetTuple.consequent && !relTuple.consequent;
            const alternateBad = targetTuple.alternate && !relTuple.alternate;
            if (consequentBad || alternateBad) {
              context.report({
                node: targetReportNode,
                message: settings.allowReferrer ? NOOPENER_MESSAGE : NOREFERRER_MESSAGE,
              });
            }
            return;
          }
          if (targetTuple.combined && !relTuple.combined) {
            context.report({
              node: targetReportNode,
              message: settings.allowReferrer ? NOOPENER_MESSAGE : NOREFERRER_MESSAGE,
            });
          }
        }
      },
    };
  },
});
