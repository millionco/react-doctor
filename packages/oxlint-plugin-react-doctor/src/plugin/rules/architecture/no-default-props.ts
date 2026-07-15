import { defineRule } from "../../utils/define-rule.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const hasReachingWriteOnAliasPath = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const visitedSymbolIds = new Set<number>();
  let reference = receiver;
  let symbol = context.scopes.symbolFor(reference);
  while (symbol) {
    if (
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, reference, context.scopes)
    ) {
      return true;
    }
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind !== "const" || !symbol.initializer) return false;
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) return false;
    reference = initializer;
    symbol = context.scopes.symbolFor(reference);
  }
  return false;
};

const isStableClassReceiver = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = resolveConstIdentifierAlias(receiver, context.scopes);
  if (!symbol || hasReachingWriteOnAliasPath(receiver, context)) return false;
  if (
    isNodeOfType(symbol.declarationNode, "ClassDeclaration") ||
    isNodeOfType(symbol.declarationNode, "ClassExpression")
  ) {
    return true;
  }
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  return Boolean(symbol.kind === "const" && isNodeOfType(initializer, "ClassExpression"));
};

export const noDefaultProps = defineRule({
  id: "no-default-props",
  title: "defaultProps removed in React 19",
  // Gated to React 19+: `defaultProps` still works on 17/18, so the
  // migration hint is pure noise there. On by default WITHIN the gate —
  // the old `defaultEnabled: false` stacked on top of this gate meant the
  // rule never fired anywhere (FN hunt, innovaccer design-system).
  requires: ["react:19"],
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    'React 19 drops `Component.defaultProps` for function components. Set the defaults in the destructured props instead: `function Foo({ size = "md", variant = "primary" })` instead of `Foo.defaultProps = { size: "md", variant: "primary" }`.',
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      const left = node.left;
      if (!isNodeOfType(left, "MemberExpression")) return;
      if (left.computed) return;
      if (!isNodeOfType(left.property, "Identifier") || left.property.name !== "defaultProps")
        return;
      if (!isNodeOfType(left.object, "Identifier")) return;
      if (!isUppercaseName(left.object.name)) return;
      if (isStableClassReceiver(left.object, context)) return;
      context.report({
        node: left,
        message: `${left.object.name}.defaultProps stops applying in React 19, so your users see missing defaults. Set them in the destructured props parameter instead, like \`function ${left.object.name}({ size = "md" })\`.`,
      });
    },
  }),
});
