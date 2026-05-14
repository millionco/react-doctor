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
    "Move side effects to `componentDidMount`; move initial state to `constructor`",
  ],
  [
    "componentWillReceiveProps",
    "Move side effects to `componentDidUpdate` (compare prevProps); move pure state derivation to the static `getDerivedStateFromProps`",
  ],
  [
    "componentWillUpdate",
    "Move DOM reads to `getSnapshotBeforeUpdate` (passes the value to `componentDidUpdate`); move other work to `componentDidUpdate`",
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
    ? `\`${originalName}\` is removed in React 19 (the UNSAFE_ prefix only silences the React 18 warning, it doesn't fix the concurrent-mode hazard).`
    : `\`${originalName}\` is removed in React 19 and warns in React 18.3.1.`;
  return `${removalNote} ${replacement}.`;
};

export const noLegacyClassLifecycles = defineRule<Rule>({
  id: "no-legacy-class-lifecycles",
  framework: "global",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Move side effects in `componentWillMount` to `componentDidMount`; replace `componentWillReceiveProps` with `componentDidUpdate` (compare prevProps) or the static `getDerivedStateFromProps` for pure state derivation; replace `componentWillUpdate` with `getSnapshotBeforeUpdate` paired with `componentDidUpdate`. The `UNSAFE_` prefix only silences the warning — React 19 removes both forms.",
  examples: [
    {
      before: "class Profile extends Component {\n  componentWillMount() { this.fetchData(); }\n}",
      after: "class Profile extends Component {\n  componentDidMount() { this.fetchData(); }\n}",
    },
  ],
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
