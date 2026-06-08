import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

interface ForbiddenPropDescriptor {
  propName: string;
  disallowedFor?: ReadonlySet<string>;
  message?: string;
}

interface ForbidDomPropsSettingsItem {
  propName: string;
  disallowedFor?: ReadonlyArray<string>;
  message?: string;
}

interface ForbidDomPropsSettings {
  forbid?: ReadonlyArray<string | ForbidDomPropsSettingsItem>;
}

const buildMessage = (propName: string, customMessage?: string): string =>
  customMessage ??
  `Your project blocks the \`${propName}\` prop on plain HTML tags, so this bypasses the agreed DOM API contract.`;

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Map<string, ForbiddenPropDescriptor> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { forbidDomProps?: ForbidDomPropsSettings }).forbidDomProps ?? {})
      : {};
  const map = new Map<string, ForbiddenPropDescriptor>();
  for (const item of ruleSettings.forbid ?? []) {
    if (typeof item === "string") {
      map.set(item, { propName: item });
    } else {
      // Pre-build a Set for O(1) tag-membership tests inside the
      // JSXOpeningElement visitor — avoids `array.includes()` on every
      // attribute (flagged by react-doctor's own `js-set-map-lookups`).
      const disallowedForSet = item.disallowedFor ? new Set(item.disallowedFor) : undefined;
      map.set(item.propName, {
        propName: item.propName,
        disallowedFor: disallowedForSet,
        message: item.message,
      });
    }
  }
  return map;
};

// Port of `oxc_linter::rules::react::forbid_dom_props`. Configurable
// via `forbid` setting; matches each prop only on DOM-tag JSX elements
// (lowercase tag names), respecting per-prop `disallowedFor` allow-lists.
export const forbidDomProps = defineRule<Rule>({
  id: "forbid-dom-props",
  title: "Blocked DOM prop bypasses project contract",
  severity: "warn",
  recommendation:
    "Configure blocked DOM props so plain HTML tags stay on the agreed DOM API surface.",
  category: "Architecture",
  create: (context) => {
    const forbidMap = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (forbidMap.size === 0) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const elementName = node.name.name;
        if (isReactComponentName(elementName)) return; // PascalCase = component
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          const propName = attribute.name.name;
          const descriptor = forbidMap.get(propName);
          if (!descriptor) continue;
          const disallowedFor = descriptor.disallowedFor;
          if (disallowedFor && disallowedFor.size > 0 && !disallowedFor.has(elementName)) {
            continue;
          }
          context.report({
            node: attribute.name,
            message: buildMessage(propName, descriptor.message),
          });
        }
      },
    };
  },
});
