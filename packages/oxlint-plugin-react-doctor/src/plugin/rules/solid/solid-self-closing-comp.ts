import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface SolidSelfClosingCompSettings {
  component?: "all" | "none";
  html?: "all" | "void" | "none";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): SolidSelfClosingCompSettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  const solidSettings = (reactDoctor as { solidSelfClosingComp?: unknown }).solidSelfClosingComp;
  if (typeof solidSettings !== "object" || solidSettings === null) return {};
  return solidSettings as SolidSelfClosingCompSettings;
};

const isDomElementName = (name: string): boolean => /^[a-z]/.test(name);

const VOID_DOM_ELEMENT_PATTERN =
  /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
const isVoidDomElementName = (name: string): boolean => VOID_DOM_ELEMENT_PATTERN.test(name);

const isComponentOpener = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  (isNodeOfType(node.name, "JSXIdentifier") && !isDomElementName(node.name.name)) ||
  isNodeOfType(node.name, "JSXMemberExpression");

const childrenAreEmpty = (jsxElement: EsTreeNodeOfType<"JSXElement">): boolean =>
  jsxElement.children.length === 0;

const childrenAreOnlyMultilineWhitespace = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
): boolean => {
  if (jsxElement.children.length !== 1) return false;
  const onlyChild = jsxElement.children[0];
  if (!isNodeOfType(onlyChild, "JSXText")) return false;
  if (onlyChild.value.indexOf("\n") === -1) return false;
  return onlyChild.value.replace(/(?!\xA0)\s/g, "") === "";
};

// Port of `solid/self-closing-comp` — adapted from
// `eslint-plugin-react`'s rule of the same name. We only report
// (we don't yet emit fixes through this plugin's adapter).
export const solidSelfClosingComp = defineRule<Rule>({
  id: "solid-self-closing-comp",
  severity: "warn",
  requires: ["solid"],
  defaultEnabled: false,
  recommendation: "Self-close empty Solid components (`<Foo />` instead of `<Foo></Foo>`).",
  create: (context: RuleContext) => {
    const settings = resolveSettings(context.settings);
    const componentMode: "all" | "none" = settings.component ?? "all";
    const htmlMode: "all" | "void" | "none" = settings.html ?? "all";
    const shouldSelfCloseWhenPossible = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
      if (isComponentOpener(node)) return componentMode === "all";
      if (!isNodeOfType(node.name, "JSXIdentifier")) return true;
      const elementName = node.name.name;
      if (!isDomElementName(elementName)) return true;
      if (htmlMode === "none") return false;
      if (htmlMode === "void") return isVoidDomElementName(elementName);
      return true;
    };
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const parent = node.parent;
        if (!parent || !isNodeOfType(parent, "JSXElement")) {
          if (!node.selfClosing && shouldSelfCloseWhenPossible(node)) {
            context.report({ node, message: "Empty components are self-closing." });
          }
          return;
        }
        const canSelfClose = childrenAreEmpty(parent) || childrenAreOnlyMultilineWhitespace(parent);
        if (!canSelfClose) return;
        const shouldSelfClose = shouldSelfCloseWhenPossible(node);
        if (shouldSelfClose && !node.selfClosing) {
          context.report({ node, message: "Empty components are self-closing." });
        } else if (!shouldSelfClose && node.selfClosing) {
          context.report({ node, message: "This element should not be self-closing." });
        }
      },
    };
  },
});
