import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const NOREFERRER_MESSAGE =
  '`target="_blank"` without `rel="noreferrer"` lets the linked page hijack your tab to a phishing site.';
const NOOPENER_MESSAGE =
  '`target="_blank"` without `rel` lets the linked page hijack your tab to a phishing site.';
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
    allowReferrer: ruleSettings.allowReferrer ?? false,
    links: ruleSettings.links ?? true,
    forms: ruleSettings.forms ?? false,
    linkComponents,
    formComponents,
  };
};

interface BranchTuple {
  // Combined verdict: "is the predicate satisfied"?
  combined: boolean;
  // Conditional test identifier name; "" if not a conditional / not an
  // Identifier.
  testName: string;
  consequent: boolean;
  alternate: boolean;
}

const isExternalLink = (href: string): boolean => href.includes("//");

const matchHrefExpression = (
  expression: EsTreeNode,
  state: { isExternal: boolean; isDynamic: boolean },
): void => {
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    if (isExternalLink(expression.value)) state.isExternal = true;
    return;
  }
  if (isNodeOfType(expression, "Identifier")) {
    state.isDynamic = true;
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    matchHrefExpression(expression.consequent as EsTreeNode, state);
    matchHrefExpression(expression.alternate as EsTreeNode, state);
  }
};

const checkHref = (
  attributeValue: EsTreeNode,
  enforceDynamicLinks: "always" | "never",
): boolean => {
  const state = { isExternal: false, isDynamic: false };
  if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
    state.isExternal = isExternalLink(attributeValue.value);
  } else if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    matchHrefExpression(attributeValue.expression as EsTreeNode, state);
  }
  if (enforceDynamicLinks === "never") {
    return !state.isExternal || state.isDynamic;
  }
  return !(state.isExternal || state.isDynamic);
};

const checkRelValue = (text: string, allowReferrer: boolean): boolean => {
  const tokens = text.split(/\s+/);
  if (allowReferrer) {
    return tokens.includes("noopener") || tokens.includes("noreferrer");
  }
  return tokens.some((token) => token.toLowerCase() === "noreferrer");
};

const matchRelExpression = (expression: EsTreeNode, allowReferrer: boolean): BranchTuple => {
  const empty: BranchTuple = { combined: false, testName: "", consequent: false, alternate: false };
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return {
      combined: checkRelValue(expression.value, allowReferrer),
      testName: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequent = matchRelExpression(expression.consequent as EsTreeNode, allowReferrer);
    const alternate = matchRelExpression(expression.alternate as EsTreeNode, allowReferrer);
    const test = expression.test as EsTreeNode;
    if (isNodeOfType(test, "Identifier")) {
      return {
        combined: consequent.combined && alternate.combined,
        testName: test.name,
        consequent: consequent.combined,
        alternate: alternate.combined,
      };
    }
    return {
      combined: consequent.combined && alternate.combined,
      testName: "",
      consequent: consequent.combined,
      alternate: alternate.combined,
    };
  }
  return empty;
};

const checkRel = (attributeValue: EsTreeNode, allowReferrer: boolean): BranchTuple => {
  const empty: BranchTuple = { combined: false, testName: "", consequent: false, alternate: false };
  if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
    return {
      combined: checkRelValue(attributeValue.value, allowReferrer),
      testName: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression as EsTreeNode;
    if (expression.type === "JSXEmptyExpression") return empty;
    return matchRelExpression(expression, allowReferrer);
  }
  return empty;
};

const matchTargetExpression = (expression: EsTreeNode): BranchTuple => {
  const empty: BranchTuple = { combined: false, testName: "", consequent: false, alternate: false };
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return {
      combined: expression.value.toLowerCase() === "_blank",
      testName: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequent = matchTargetExpression(expression.consequent as EsTreeNode);
    const alternate = matchTargetExpression(expression.alternate as EsTreeNode);
    const test = expression.test as EsTreeNode;
    const combined = consequent.combined || alternate.combined;
    if (isNodeOfType(test, "Identifier")) {
      return {
        combined,
        testName: test.name,
        consequent: consequent.combined,
        alternate: alternate.combined,
      };
    }
    return {
      combined,
      testName: "",
      consequent: consequent.combined,
      alternate: alternate.combined,
    };
  }
  return empty;
};

const checkTarget = (attributeValue: EsTreeNode): BranchTuple => {
  if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
    return {
      combined: attributeValue.value.toLowerCase() === "_blank",
      testName: "",
      consequent: false,
      alternate: false,
    };
  }
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression as EsTreeNode;
    if (expression.type === "JSXEmptyExpression") {
      return { combined: false, testName: "", consequent: false, alternate: false };
    }
    return matchTargetExpression(expression);
  }
  return { combined: false, testName: "", consequent: false, alternate: false };
};

const getOpeningElementName = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  const name = node.name as EsTreeNode;
  if (isNodeOfType(name, "JSXIdentifier")) return name.name;
  return null;
};

// Port of `oxc_linter::rules::react::jsx_no_target_blank`.
export const jsxNoTargetBlank = defineRule<Rule>({
  id: "jsx-no-target-blank",
  title: "Unsafe target=_blank link",
  severity: "warn",
  recommendation: 'Add `rel="noreferrer"` (or `"noopener"`) when using `target="_blank"`.',
  category: "Security",
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
        const tagName = getOpeningElementName(node);
        if (!tagName) return;
        if (!isLink(tagName) && !isForm(tagName)) return;

        const linkAttributeNames = settings.linkComponents.get(tagName) ?? ["href"];
        const formAttributeNames = settings.formComponents.get(tagName) ?? ["action"];

        let targetTuple: BranchTuple = {
          combined: false,
          testName: "",
          consequent: false,
          alternate: false,
        };
        let relTuple: BranchTuple = {
          combined: false,
          testName: "",
          consequent: false,
          alternate: false,
        };
        let isHrefValid = true;
        let hasHrefValue = false;
        let warnSpread = false;
        let targetReportNode: EsTreeNode = node.name as EsTreeNode;
        let spreadReportNode: EsTreeNode | null = null;

        for (const attribute of node.attributes) {
          if (isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute")) {
            if (settings.warnOnSpreadAttributes) {
              warnSpread = true;
              spreadReportNode = attribute as EsTreeNode;
              targetTuple = { combined: false, testName: "", consequent: false, alternate: false };
              relTuple = { combined: false, testName: "", consequent: false, alternate: false };
              isHrefValid = false;
              hasHrefValue = true;
            }
            continue;
          }
          if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) continue;
          const attributeName = (attribute as EsTreeNodeOfType<"JSXAttribute">).name;
          if (!isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier")) continue;
          const propName = (attributeName as EsTreeNodeOfType<"JSXIdentifier">).name;
          const value = (attribute as EsTreeNodeOfType<"JSXAttribute">).value as EsTreeNode | null;
          if (propName === "target") {
            if (value) {
              targetTuple = checkTarget(value);
              targetReportNode = value;
            }
          } else if (
            propName === "href" ||
            propName === "action" ||
            linkAttributeNames.includes(propName) ||
            formAttributeNames.includes(propName)
          ) {
            if (value) {
              hasHrefValue = true;
              isHrefValid = checkHref(value, settings.enforceDynamicLinks);
            }
          } else if (propName === "rel" && value) {
            relTuple = checkRel(value, settings.allowReferrer);
          }
        }

        if (warnSpread) {
          if ((hasHrefValue && isHrefValid) || relTuple.combined) return;
          context.report({ node: spreadReportNode ?? node, message: SPREAD_MESSAGE });
          return;
        }

        if (!isHrefValid) {
          // Conditional-expression alignment: when target and rel
          // depend on the SAME test identifier, we evaluate per-branch.
          if (targetTuple.testName !== "" && targetTuple.testName === relTuple.testName) {
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
