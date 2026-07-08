import { compileGlob } from "../../utils/compile-glob.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";

interface ForbidEntry {
  propName?: string;
  propNamePattern?: string;
  allowedFor?: ReadonlyArray<string>;
  allowedForPatterns?: ReadonlyArray<string>;
  disallowedFor?: ReadonlyArray<string>;
  disallowedForPatterns?: ReadonlyArray<string>;
  message?: string;
}

interface ForbidComponentPropsSettings {
  forbid?: ReadonlyArray<string | ForbidEntry>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ForbidComponentPropsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { forbidComponentProps?: ForbidComponentPropsSettings })
          .forbidComponentProps ?? {})
      : {};
  // Divergence from OXC: upstream defaults `forbid` to [className,
  // style] when unconfigured, which flags the canonical Tailwind /
  // shadcn / Radix customization pattern (`<Component className=… />`)
  // on EVERY component usage — prod telemetry showed hundreds of
  // firings per run from exactly this. The rule's premise ("YOUR
  // project blocks this prop") is inherently project-specific, so
  // without an explicit `forbid` list it stays inert.
  return { forbid: ruleSettings.forbid ?? [] };
};

// Convert a glob like `Foo*` / `*Foo` / `Foo*Bar` into a RegExp.
interface NormalizedEntry {
  propRegex: RegExp;
  isExactProp: boolean;
  exactPropName: string | null;
  allowedFor: ReadonlyArray<string>;
  allowedForPatterns: ReadonlyArray<RegExp>;
  disallowedFor: ReadonlyArray<string>;
  disallowedForPatterns: ReadonlyArray<RegExp>;
  message: string | null;
}

const normalizeEntry = (raw: string | ForbidEntry): NormalizedEntry => {
  if (typeof raw === "string") {
    return {
      propRegex: new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&")}$`),
      isExactProp: true,
      exactPropName: raw,
      allowedFor: [],
      allowedForPatterns: [],
      disallowedFor: [],
      disallowedForPatterns: [],
      message: null,
    };
  }
  const propPattern = raw.propNamePattern ?? raw.propName ?? "";
  return {
    propRegex: compileGlob(propPattern),
    isExactProp: raw.propName !== undefined && raw.propNamePattern === undefined,
    exactPropName: raw.propName ?? null,
    allowedFor: raw.allowedFor ?? [],
    allowedForPatterns: (raw.allowedForPatterns ?? []).map(compileGlob),
    disallowedFor: raw.disallowedFor ?? [],
    disallowedForPatterns: (raw.disallowedForPatterns ?? []).map(compileGlob),
    message: raw.message ?? null,
  };
};

// Returns true if `tag` is forbidden under the given entry.
const isForbiddenForTag = (entry: NormalizedEntry, tag: string): boolean => {
  const hasDisallow = entry.disallowedFor.length > 0 || entry.disallowedForPatterns.length > 0;
  if (hasDisallow) {
    if (entry.disallowedFor.includes(tag)) return true;
    return entry.disallowedForPatterns.some((regex) => regex.test(tag));
  }
  // No disallow rules — when allowedFor is empty, default-allowed
  // (don't flag). When allowedFor is set, flag everything NOT in it.
  if (entry.allowedFor.length === 0 && entry.allowedForPatterns.length === 0) return true;
  if (entry.allowedFor.includes(tag)) return false;
  if (entry.allowedForPatterns.some((regex) => regex.test(tag))) return false;
  return true;
};

const flattenJsxName = (name: EsTreeNode): string => {
  if (isNodeOfType(name, "JSXIdentifier")) return name.name;
  if (isNodeOfType(name, "JSXMemberExpression")) {
    const obj = flattenJsxName(name.object);
    return `${obj}.${name.property.name}`;
  }
  if (name.type === "ThisExpression" || name.type === ("JSXThisExpression" as unknown as string)) {
    return "this";
  }
  return "";
};

const isSupportedJsxName = (name: EsTreeNode): boolean =>
  isNodeOfType(name, "JSXIdentifier") || isNodeOfType(name, "JSXMemberExpression");

const buildMessage = (propName: string, message: string | null): string =>
  message ??
  `Your project blocks the \`${propName}\` prop on this component, so this bypasses the component API contract.`;

// Port of `oxc_linter::rules::react::forbid_component_props`. Reports
// configured props on user-defined (PascalCase / namespaced) JSX
// components.
export const forbidComponentProps = defineRule({
  id: "forbid-component-props",
  title: "Blocked component prop bypasses API contract",
  severity: "warn",
  // Default off AND inert without an explicit `forbid` list (see
  // `resolveSettings`): enforcing a blocked-prop contract only makes
  // sense when the project names the props to block. Opt in via config
  // when you want to enforce a strict design-system API.
  defaultEnabled: false,
  recommendation:
    "Configure blocked component props so callers cannot bypass the component API contract.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const entries = settings.forbid.map(normalizeEntry);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (entries.length === 0) return;
        // Skip unsupported namespaced shapes (e.g. <fbt:param>).
        if (!isSupportedJsxName(node.name as EsTreeNode)) return;
        const tag = flattenJsxName(node.name as EsTreeNode);
        if (!tag) return;
        // Only apply to user components (PascalCase) and member-expr
        // names (`Module.Foo`). HTML tags pass through.
        const isUserComponent = isReactComponentName(tag.split(".")[0]!) || tag.includes(".");
        if (!isUserComponent) return;

        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          const propName = getJsxAttributeName(attribute.name);
          if (!propName) continue;
          for (const entry of entries) {
            if (entry.isExactProp && entry.exactPropName !== propName) continue;
            if (!entry.propRegex.test(propName)) continue;
            if (!isForbiddenForTag(entry, tag)) continue;
            context.report({
              node: attribute,
              message: buildMessage(propName, entry.message),
            });
            break;
          }
        }
      },
    };
  },
});
