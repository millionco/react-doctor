import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "Spreading props after defaults copies an explicit `undefined` over a default, so the component runs without the default it declared. Use `defaults({}, props, defaultProps)` or filter out `undefined` keys before merging.";

const DEFAULTS_IDENTIFIER_PATTERN = /default|config/i;
const COMPONENT_OR_HOOK_NAME_PATTERN = /^(use[A-Z]|[A-Z])/;

const identifierIsComponentOrHookName = (name: string): boolean =>
  COMPONENT_OR_HOOK_NAME_PATTERN.test(name);

// A React component/hook file: contains JSX, or declares a `use*`/PascalCase
// function. Plain config/util merges (`{ ...defaults, ...opts }`) are the
// standard, safe idiom and must stay quiet.
const fileIsComponentOrHookContext = (programNode: EsTreeNode): boolean => {
  let isComponentOrHook = false;
  walkAst(programNode, (node: EsTreeNode) => {
    if (isComponentOrHook) return false;
    if (
      isNodeOfType(node, "JSXElement") ||
      isNodeOfType(node, "JSXFragment") ||
      isNodeOfType(node, "JSXOpeningElement")
    ) {
      isComponentOrHook = true;
      return false;
    }
    if (
      isNodeOfType(node, "FunctionDeclaration") &&
      node.id &&
      identifierIsComponentOrHookName(node.id.name)
    ) {
      isComponentOrHook = true;
      return false;
    }
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      identifierIsComponentOrHookName(node.id.name) &&
      isFunctionLike(node.init as EsTreeNode | null | undefined)
    ) {
      isComponentOrHook = true;
      return false;
    }
  });
  return isComponentOrHook;
};

const typeAnnotationHasOptionalMember = (typeNode: EsTreeNode): boolean => {
  // A named type reference (`Props`) may declare optional members we can't see
  // across files, so treat it as possibly-optional. An inline object type is
  // fully visible: only flag when it actually has a `?` member.
  if (isNodeOfType(typeNode, "TSTypeReference")) return true;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    return typeNode.members.some((member) =>
      Boolean((member as { optional?: boolean }).optional)
    );
  }
  return false;
};

// The later-spread operand can carry keys explicitly set to `undefined`: it is
// the component's `props` identifier, or a binding whose declared type has
// optional (`?`) members. Fully-required inline types and object-literal
// bindings cannot, so they stay quiet.
const laterOperandCanCarryExplicitUndefined = (
  identifier: EsTreeNodeOfType<"Identifier">
): boolean => {
  if (identifier.name === "props") return true;
  const binding = findVariableInitializer(
    identifier as EsTreeNode,
    identifier.name
  );
  const bindingIdentifier = binding?.bindingIdentifier;
  if (!bindingIdentifier) return false;
  const typeAnnotation = (bindingIdentifier as { typeAnnotation?: EsTreeNode })
    .typeAnnotation;
  const annotatedType = typeAnnotation
    ? (typeAnnotation as { typeAnnotation?: EsTreeNode }).typeAnnotation
    : null;
  if (!annotatedType) return false;
  return typeAnnotationHasOptionalMember(annotatedType);
};

const spreadArgumentIdentifier = (
  spread: EsTreeNode
): EsTreeNodeOfType<"Identifier"> | null => {
  const argument = (spread as { argument?: EsTreeNode }).argument;
  return argument && isNodeOfType(argument, "Identifier") ? argument : null;
};

// Flags `{ ...defaultProps, ...props }` inside a React component/hook file where
// the first spread is a defaults/config identifier and the last spread is the
// `props` identifier (or an optional-typed props binding). The later spread
// copies an explicit `undefined` over the default, silently dropping it. Config
// merges, test files, object-literal operands, and fully-required types stay quiet.
export const noSpreadPropsOverDefaultsClobbersWithUndefined = defineRule({
  id: "no-spread-props-over-defaults-clobbers-with-undefined",
  title: "Spread props over defaults can clobber with undefined",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "`{ ...defaults, ...props }` lets an explicit `undefined` on props overwrite a default, so a caller passing `prop={undefined}` loses the default. Merge with `defaults({}, props, defaultProps)` or strip `undefined` keys first.",
  create: (context: RuleContext) => {
    let fileIsComponentOrHook = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsComponentOrHook = fileIsComponentOrHookContext(
          node as EsTreeNode
        );
      },
      ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
        if (!fileIsComponentOrHook) return;
        const spreads = node.properties.filter((property) =>
          isNodeOfType(property as EsTreeNode, "SpreadElement")
        );
        if (spreads.length < 2) return;

        const firstSpreadIdentifier = spreadArgumentIdentifier(
          spreads[0] as EsTreeNode
        );
        if (
          !firstSpreadIdentifier ||
          !DEFAULTS_IDENTIFIER_PATTERN.test(firstSpreadIdentifier.name)
        ) {
          return;
        }
        const lastSpreadIdentifier = spreadArgumentIdentifier(
          spreads[spreads.length - 1] as EsTreeNode
        );
        if (!lastSpreadIdentifier) return;
        if (!laterOperandCanCarryExplicitUndefined(lastSpreadIdentifier))
          return;

        context.report({ node, message: MESSAGE });
      },
    };
  },
});
