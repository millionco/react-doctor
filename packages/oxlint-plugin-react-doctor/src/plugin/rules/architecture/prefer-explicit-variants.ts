import { BOOLEAN_PROP_VARIANT_BRANCH_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isBooleanPrefixedPropName } from "../../utils/is-boolean-prefixed-prop-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isJsxElementOrFragment } from "../../utils/is-jsx-element-or-fragment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Resolve a ternary `test` to the local binding name when it is a bare
// boolean prop (`isEditing ? …`) or its negation (`!isEditing ? …`), and
// only when that binding is one of the component's boolean-prefixed props.
// Anything else (member access, `===` comparisons, logical chains) is not a
// "boolean prop variant switch" and is intentionally ignored.
const resolveBooleanPropTestName = (
  testNode: EsTreeNode,
  booleanPropBindings: ReadonlySet<string>,
): string | null => {
  let identifierNode = stripParenExpression(testNode);
  if (isNodeOfType(identifierNode, "UnaryExpression") && identifierNode.operator === "!") {
    identifierNode = stripParenExpression(identifierNode.argument);
  }
  if (!isNodeOfType(identifierNode, "Identifier")) return null;
  return booleanPropBindings.has(identifierNode.name) ? identifierNode.name : null;
};

// Cross-cutting state / responsive / auth booleans whose two-way render
// (`isLoading ? <Spinner /> : <Content />`) is ordinary conditional UI, not
// the "variants jammed into one component" smell. Excluded so the rule fires
// on domain "mode" props (isThread, isEditing, isPrimary) and stays quiet on
// these. Curated, not exhaustive — precision over recall for an opinionated rule.
const CROSS_CUTTING_STATE_BOOLEAN_NAMES = new Set<string>([
  "isLoading",
  "isPending",
  "isFetching",
  "isRefetching",
  "isSubmitting",
  "isError",
  "isSuccess",
  "isEmpty",
  "isReady",
  "isDirty",
  "isValid",
  "isInvalid",
  "isOpen",
  "isClosed",
  "isVisible",
  "isHidden",
  "isActive",
  "isInactive",
  "isExpanded",
  "isCollapsed",
  "isSelected",
  "isChecked",
  "isDisabled",
  "isEnabled",
  "isFocused",
  "isHovered",
  "isDragging",
  "isFullscreen",
  "isMobile",
  "isDesktop",
  "isTablet",
  "isOnline",
  "isOffline",
  "isLoggedIn",
  "isAuthenticated",
  "isAuthorized",
  "isDark",
  "isLight",
]);

// The local binding name of a destructured boolean-prefixed prop, following
// renames (`{ isThread: renamed }`) and defaults (`{ isPrimary = false }`)
// so the ternary-test lookup matches what the body actually references.
const collectBooleanPropBindings = (param: EsTreeNode | undefined): Set<string> => {
  const bindings = new Set<string>();
  if (!param || !isNodeOfType(param, "ObjectPattern")) return bindings;
  for (const property of param.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    if (!isNodeOfType(property.key, "Identifier")) continue;
    if (!isBooleanPrefixedPropName(property.key.name)) continue;
    if (CROSS_CUTTING_STATE_BOOLEAN_NAMES.has(property.key.name)) continue;
    const propertyValue = property.value;
    if (isNodeOfType(propertyValue, "Identifier")) {
      bindings.add(propertyValue.name);
    } else if (
      isNodeOfType(propertyValue, "AssignmentPattern") &&
      isNodeOfType(propertyValue.left, "Identifier")
    ) {
      bindings.add(propertyValue.left.name);
    }
  }
  return bindings;
};

const collectVariantBranchProps = (
  body: EsTreeNode | undefined,
  booleanPropBindings: ReadonlySet<string>,
): Set<string> => {
  const variantBranchProps = new Set<string>();
  if (!body) return variantBranchProps;
  walkAst(body, (current: EsTreeNode) => {
    // A ternary inside a nested function (render prop, event handler, inner
    // component) does not select THIS component's rendered output — prune it.
    if (isNodeOfType(current, "FunctionDeclaration") || isInlineFunctionExpression(current)) {
      return false;
    }
    if (!isNodeOfType(current, "ConditionalExpression")) return;
    const propName = resolveBooleanPropTestName(current.test, booleanPropBindings);
    if (!propName) return;
    // Both arms must be JSX: a two-sided component swap, not a visibility
    // toggle (`isOpen ? <Panel /> : null`) or a value pick. Strip parens
    // first — Prettier wraps multi-line ternary arms in parentheses, which
    // the parser surfaces as a `ParenthesizedExpression` around the JSX.
    const consequent = stripParenExpression(current.consequent);
    const alternate = stripParenExpression(current.alternate);
    if (!isJsxElementOrFragment(consequent) || !isJsxElementOrFragment(alternate)) return;
    variantBranchProps.add(propName);
  });
  return variantBranchProps;
};

// HACK: a component that selects which component to render from multiple
// boolean props (`isThread ? <A /> : <B />` plus `isEditing ? <C /> : <D />`)
// is several variants jammed into one — the "explicit variants" smell from
// the composition-patterns guidance. We require TWO distinct boolean props
// each driving a two-sided JSX ternary, because a single such switch
// (`isMobile ? <Mobile /> : <Desktop />`) is a legitimate, common pattern.
// Name-based prop detection mirrors `no-many-boolean-props` (TS types aren't
// visible at this AST layer). v1 only models two-sided ternaries on
// destructured props; if/else early-return variants and multi-way chains
// ending in `null` are out of scope.
export const preferExplicitVariants = defineRule<Rule>({
  id: "prefer-explicit-variants",
  title: "Prefer explicit variant components",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Replace boolean props that switch whole subtrees with explicit variant components, like `<ThreadComposer />` and `<EditMessageComposer />`, so each variant renders one clear path.",
  create: (context: RuleContext) => {
    const checkComponent = (
      param: EsTreeNode | undefined,
      body: EsTreeNode | undefined,
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      const booleanPropBindings = collectBooleanPropBindings(param);
      if (booleanPropBindings.size < BOOLEAN_PROP_VARIANT_BRANCH_THRESHOLD) return;
      const variantBranchProps = collectVariantBranchProps(body, booleanPropBindings);
      if (variantBranchProps.size < BOOLEAN_PROP_VARIANT_BRANCH_THRESHOLD) return;
      const propList = [...variantBranchProps].slice(0, 3).join(", ");
      const overflow = variantBranchProps.size > 3 ? "…" : "";
      context.report({
        node: reportNode,
        message: `Component "${componentName}" picks which component to render from ${variantBranchProps.size} boolean props (${propList}${overflow}), which multiplies untestable variants. Split it into explicit variant components so each renders one clear path.`,
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        checkComponent(node.params?.[0], node.body, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isInlineFunctionExpression(node.init)) return;
        checkComponent(node.init.params?.[0], node.init.body, node.id.name, node.id);
      },
    };
  },
});
