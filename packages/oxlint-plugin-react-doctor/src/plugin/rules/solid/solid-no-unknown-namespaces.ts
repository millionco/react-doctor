import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const KNOWN_NAMESPACES: ReadonlyArray<string> = ["on", "oncapture", "use", "prop", "attr", "bool"];
const STYLE_NAMESPACES: ReadonlyArray<string> = ["style", "class"];
const XML_NAMESPACES: ReadonlyArray<string> = ["xmlns", "xlink"];

interface SolidNoUnknownNamespacesSettings {
  allowedNamespaces?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): SolidNoUnknownNamespacesSettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  const solidSettings = (reactDoctor as { solidNoUnknownNamespaces?: unknown })
    .solidNoUnknownNamespaces;
  if (typeof solidSettings !== "object" || solidSettings === null) return {};
  return solidSettings as SolidNoUnknownNamespacesSettings;
};

const isDomElementName = (name: string): boolean => /^[a-z]/.test(name);

// Port of `solid/no-unknown-namespaces` — flag any `ns:name` JSX
// attribute whose `ns` is not one of Solid's six recognised special
// prefixes (plus `xmlns:` / `xlink:` SVG), and warn that namespaced
// props on components have no effect.
export const solidNoUnknownNamespaces = defineRule<Rule>({
  id: "solid-no-unknown-namespaces",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Use one of Solid's special prefixes (`on:`, `use:`, `prop:`, `attr:`, `bool:`, `oncapture:`).",
  create: (context: RuleContext) => {
    const settings = resolveSettings(context.settings);
    const allowedNamespaces = new Set(settings.allowedNamespaces ?? []);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXNamespacedName")) return;
        const namespace = node.name.namespace.name;
        const propertyName = node.name.name.name;
        const opening = node.parent;
        if (!opening || !isNodeOfType(opening, "JSXOpeningElement")) return;
        if (isNodeOfType(opening.name, "JSXIdentifier") && !isDomElementName(opening.name.name)) {
          context.report({
            node: node.name,
            message: "Namespaced props have no effect on components.",
          });
          return;
        }
        if (
          KNOWN_NAMESPACES.includes(namespace) ||
          XML_NAMESPACES.includes(namespace) ||
          allowedNamespaces.has(namespace)
        ) {
          return;
        }
        if (STYLE_NAMESPACES.includes(namespace)) {
          context.report({
            node: node.name,
            message: `Using the '${namespace}:' special prefix is potentially confusing, prefer the '${namespace}' prop instead.`,
          });
          return;
        }
        context.report({
          node: node.name,
          message: `'${namespace}:${propertyName}' uses '${namespace}:', which is not one of Solid's special JSX prefixes.`,
        });
      },
    };
  },
});
