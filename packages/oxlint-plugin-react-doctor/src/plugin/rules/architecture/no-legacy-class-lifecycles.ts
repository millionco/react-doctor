import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: Stored as a Map (not a plain object) because plain-object lookups inherit
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
  const migrationNote = hasUnsafePrefix
    ? `\`${originalName}\` is a historical lifecycle with concurrent-rendering risks; the UNSAFE_ prefix does not make its work concurrent-safe.`
    : `\`${originalName}\` is a legacy pre-commit lifecycle with concurrent-rendering risks. Review its work before choosing a migration.`;
  return `${migrationNote} ${replacement}.`;
};

export const noLegacyClassLifecycles = defineRule({
  id: "no-legacy-class-lifecycles",
  title: "Legacy class lifecycle methods",
  severity: "error",
  category: "Correctness",
  // Matches purely on the class-member NAME (`componentWillMount`, …) with
  // no React-import/component guard, so on a non-React project an ordinary
  // class method of the same name would false-fire. The legacy lifecycles
  // only mean anything with React, so require it.
  requires: ["react"],
  tags: ["migration-hint"],
  recommendation:
    "Choose a replacement for the lifecycle's intent: constructor or class fields for pure initial setup, `componentDidMount` for mount side effects, render-time derivation or guarded `componentDidUpdate` for prop-driven work, and `getSnapshotBeforeUpdate` for pre-update DOM reads. The documented `UNSAFE_` aliases do not make pre-commit work concurrent-safe.",
  create: (context: RuleContext) => {
    const checkMember = (memberNode: EsTreeNode | undefined): void => {
      if (!memberNode) return;
      if (
        !isNodeOfType(memberNode, "MethodDefinition") &&
        !isNodeOfType(memberNode, "PropertyDefinition")
      )
        return;
      // React calls lifecycles as instance methods with literal names — a
      // static member or a computed `[componentWillMount]()` key (where the
      // identifier is a VARIABLE reference, not the method name) is never a
      // lifecycle.
      if (memberNode.static || memberNode.computed) return;
      if (!isNodeOfType(memberNode.key, "Identifier")) return;
      const message = buildLegacyLifecycleMessage(memberNode.key.name);
      if (message) context.report({ node: memberNode.key, message });
    };

    return {
      ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
        // A React class component MUST extend React.Component (directly or
        // via a base class) — a class with no `extends` can't be one, so a
        // method named `componentWillMount` there is ordinary code. We only
        // require SOME superclass (not `Component` by name) because legacy
        // codebases routinely extend their own base classes.
        const classNode = node.parent;
        if (!classNode) return;
        if (
          !isNodeOfType(classNode, "ClassDeclaration") &&
          !isNodeOfType(classNode, "ClassExpression")
        )
          return;
        if (!classNode.superClass) return;
        for (const member of node.body ?? []) {
          checkMember(member);
        }
      },
    };
  },
});
