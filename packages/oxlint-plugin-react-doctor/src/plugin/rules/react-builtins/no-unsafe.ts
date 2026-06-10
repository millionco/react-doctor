import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getParentComponent } from "../../utils/get-parent-component.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const UNSAFE_PREFIXED = new Set([
  "UNSAFE_componentWillMount",
  "UNSAFE_componentWillReceiveProps",
  "UNSAFE_componentWillUpdate",
]);
const UNSAFE_ALIASES = new Set([
  "componentWillMount",
  "componentWillReceiveProps",
  "componentWillUpdate",
]);

const buildMessage = (methodName: string): string =>
  `\`${methodName}\` runs during unsafe legacy render timing and is deprecated, so React may double-invoke or remove it.`;

interface NoUnsafeSettings {
  checkAliases?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoUnsafeSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noUnsafe?: NoUnsafeSettings }).noUnsafe ?? {})
      : {};
  return { checkAliases: ruleSettings.checkAliases ?? false };
};

// Reads `settings.react.version` (OXC's source of truth for the project's
// React version). Returns null when no version is configured; that's
// treated as "modern enough", i.e. always flag UNSAFE_*.
const getConfiguredReactMajorMinor = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { major: number; minor: number } | null => {
  if (!settings || typeof settings !== "object") return null;
  const reactBlock = (settings as { react?: { version?: unknown } }).react;
  if (!reactBlock || typeof reactBlock !== "object") return null;
  const version = reactBlock.version;
  if (typeof version !== "string") return null;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
};

const isReactVersionAtLeast = (
  reactVersion: { major: number; minor: number } | null,
  major: number,
  minor: number,
): boolean => {
  if (!reactVersion) return true; // unknown → assume modern
  if (reactVersion.major > major) return true;
  if (reactVersion.major < major) return false;
  return reactVersion.minor >= minor;
};

const getStaticKeyName = (key: EsTreeNode): string | null => {
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  return null;
};

// Port of `oxc_linter::rules::react::no_unsafe`. Reports the
// `UNSAFE_*` lifecycle methods (`componentWillMount`, `…WillReceiveProps`,
// `…WillUpdate`) on React class components, plus the non-prefixed
// aliases when `checkAliases: true`. Does NOT gate on React version
// (OXC's port does — we always assume modern React, where the prefixes
// are valid).
export const noUnsafe = defineRule<Rule>({
  id: "no-unsafe",
  title: "Unsafe legacy lifecycle method",
  severity: "warn",
  recommendation:
    "Move setup to `constructor` or `componentDidMount`, prop-derived state to `getDerivedStateFromProps`, and update side effects to `componentDidUpdate` so React does not rely on deprecated unsafe lifecycles.",
  create: (context) => {
    const { checkAliases } = resolveSettings(context.settings);
    const reactVersion = getConfiguredReactMajorMinor(context.settings);
    // `UNSAFE_componentWillMount` etc. didn't exist before React 16.3 —
    // skip flagging them on older project versions to match OXC.
    const flagsUnsafePrefix = isReactVersionAtLeast(reactVersion, 16, 3);

    const matchesActiveUnsafe = (name: string): boolean => {
      if (UNSAFE_PREFIXED.has(name)) return flagsUnsafePrefix;
      if (UNSAFE_ALIASES.has(name)) return checkAliases;
      return false;
    };

    return {
      MethodDefinition(node: EsTreeNodeOfType<"MethodDefinition">) {
        const name = getStaticKeyName(node.key);
        if (!name || !matchesActiveUnsafe(name)) return;
        const enclosing = getParentComponent(node);
        if (!enclosing) return;
        context.report({ node: node.key, message: buildMessage(name) });
      },
      Property(node: EsTreeNodeOfType<"Property">) {
        const name = getStaticKeyName(node.key);
        if (!name || !matchesActiveUnsafe(name)) return;
        let ancestor: EsTreeNode | null | undefined = node.parent;
        while (ancestor) {
          if (isEs5Component(ancestor)) {
            context.report({ node: node.key, message: buildMessage(name) });
            return;
          }
          ancestor = ancestor.parent ?? null;
        }
      },
    };
  },
});
