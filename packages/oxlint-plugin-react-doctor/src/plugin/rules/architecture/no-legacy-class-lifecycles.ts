import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: the three legacy class lifecycles `componentWillMount`,
// `componentWillReceiveProps`, and `componentWillUpdate` are unsafe
// under concurrent rendering because the renderer can call them, throw
// the work away, and call them again. React 18.3.1 emits a warning;
// React 19 REMOVES them entirely (the `UNSAFE_` prefix included). We
// flag both forms so the prefix doesn't get treated as a permanent fix.
//
// Stored as a Map (not a plain object) because plain-object lookups inherit
// from `Object.prototype` — `LEGACY_LIFECYCLE_REPLACEMENTS["constructor"]`
// returns the native `Object` function (truthy), which previously made the
// rule false-positive on every class with a constructor (Lexical nodes,
// MobX stores, custom Error subclasses, etc.). Maps return `undefined` for
// missing keys with no prototype fall-through.
const LEGACY_LIFECYCLE_REPLACEMENTS = new Map<string, string>([
  [
    "componentWillMount",
    "Put side effects in `componentDidMount` & initial state in the `constructor`",
  ],
  [
    "componentWillReceiveProps",
    "Put side effects in `componentDidUpdate` & derived state in the static `getDerivedStateFromProps`",
  ],
  [
    "componentWillUpdate",
    "Read the DOM in `getSnapshotBeforeUpdate` & do other work in `componentDidUpdate`",
  ],
]);

interface UnsafePrefixSplit {
  baseName: string;
  hasUnsafePrefix: boolean;
}

const stripUnsafePrefix = (name: string): UnsafePrefixSplit => {
  if (name.startsWith("UNSAFE_")) {
    return { baseName: name.slice("UNSAFE_".length), hasUnsafePrefix: true };
  }
  return { baseName: name, hasUnsafePrefix: false };
};

const buildLegacyLifecycleMessage = (originalName: string): string | null => {
  const { baseName, hasUnsafePrefix } = stripUnsafePrefix(originalName);
  const replacement = LEGACY_LIFECYCLE_REPLACEMENTS.get(baseName);
  if (!replacement) return null;
  const removalNote = hasUnsafePrefix
    ? `\`${originalName}\` breaks under concurrent rendering & is gone in React 19, & the UNSAFE_ prefix only hides the warning.`
    : `\`${originalName}\` breaks under concurrent rendering, warns in React 18 & is gone in React 19.`;
  return `${removalNote} ${replacement}.`;
};

export const noLegacyClassLifecycles = defineRule<Rule>({
  id: "no-legacy-class-lifecycles",
  title: "Legacy class lifecycle methods",
  severity: "error",
  category: "Correctness",
  tags: ["migration-hint"],
  recommendation:
    "Move `componentWillMount` work to `componentDidMount`, `componentWillReceiveProps` to `componentDidUpdate` or the static `getDerivedStateFromProps`, and `componentWillUpdate` to `getSnapshotBeforeUpdate` plus `componentDidUpdate`. The `UNSAFE_` prefix only hides the warning. React 19 removes both.",
  create: (context: RuleContext) => {
    const checkMember = (memberNode: EsTreeNode | undefined): void => {
      if (!memberNode) return;
      if (
        !isNodeOfType(memberNode, "MethodDefinition") &&
        !isNodeOfType(memberNode, "PropertyDefinition")
      )
        return;
      if (!isNodeOfType(memberNode.key, "Identifier")) return;
      const message = buildLegacyLifecycleMessage(memberNode.key.name);
      if (message) context.report({ node: memberNode.key, message });
    };

    return {
      ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
        for (const member of node.body ?? []) {
          checkMember(member);
        }
      },
    };
  },
});
