import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

interface ThresholdDerivedBinding {
  continuousName: string;
  hookName: string;
  declarator: EsTreeNode;
  thresholdDeclarators: EsTreeNode[];
}

const CONTINUOUS_VALUE_HOOK_PATTERN =
  /^use(?:Window(?:Width|Height|Dimensions)|Scroll(?:Position|Y|X)|MousePosition|ResizeObserver|IntersectionObserver)/;

// HACK: hooks that return a continuously-changing numeric value
// (`useWindowWidth`, `useScrollPosition`, etc.) trigger a re-render on
// every change. If the component only cares about a coarser boolean
// derived from that value (`width < 768` → "is mobile"), it ends up
// rendering on every pixel of resize. Use a media-query / threshold
// hook (`useMediaQuery("(max-width: 767px)")`) which only fires when
// the threshold flips.
//
// Heuristic: `const x = useFooBar(...)` immediately followed by a
// `const y = x [<>=] literal` (or boolean expression on x), where y is
// the only value referenced in the JSX.
const isThresholdComparison = (node: EsTreeNode, valueName: string): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (!["<", "<=", ">", ">=", "===", "!==", "==", "!="].includes(node.operator)) return false;
  const referencesContinuous =
    (isNodeOfType(node.left, "Identifier") && node.left.name === valueName) ||
    (isNodeOfType(node.right, "Identifier") && node.right.name === valueName);
  if (!referencesContinuous) return false;
  return isNodeOfType(node.left, "Literal") || isNodeOfType(node.right, "Literal");
};

// The continuous value is only over-rendering noise when the component
// solely cares about the derived boolean. If the raw value is also read
// elsewhere (e.g. `{width}px` in the JSX), it legitimately needs the
// continuous value, so caching it behind a threshold hook would change
// behaviour. Allowed references: the hook binding declarator itself and
// every threshold comparison declarator derived from it.
const isContinuousReferencedElsewhere = (
  componentBody: EsTreeNode,
  binding: ThresholdDerivedBinding,
): boolean => {
  let referencedElsewhere = false;
  walkAst(componentBody, (child: EsTreeNode): boolean | void => {
    if (referencedElsewhere) return false;
    if (child === binding.declarator || binding.thresholdDeclarators.includes(child)) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    if (child.name !== binding.continuousName) return;
    const parent = child.parent;
    if (isNodeOfType(parent, "MemberExpression") && !parent.computed && parent.property === child) {
      return;
    }
    if (isNodeOfType(parent, "Property") && !parent.computed && parent.key === child) return;
    referencedElsewhere = true;
  });
  return referencedElsewhere;
};

const findThresholdDerivedBindings = (
  componentBody: EsTreeNode,
): Array<ThresholdDerivedBinding> => {
  const out: Array<ThresholdDerivedBinding> = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return out;
  const statements = componentBody.body ?? [];

  for (let outerIndex = 0; outerIndex < statements.length; outerIndex++) {
    const outerStatement = statements[outerIndex];
    if (!isNodeOfType(outerStatement, "VariableDeclaration")) continue;

    for (const declarator of outerStatement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const init = declarator.init;
      if (!isNodeOfType(init, "CallExpression")) continue;
      if (!isNodeOfType(init.callee, "Identifier")) continue;
      if (!CONTINUOUS_VALUE_HOOK_PATTERN.test(init.callee.name)) continue;

      const continuousName = declarator.id.name;
      const hookName = init.callee.name;

      // Collect every derived threshold binding from the following
      // statement(s) — a multi-breakpoint component (`isMobile = width <
      // 768; isDesktop = width > 1024`) derives several booleans from the
      // same continuous value, and each one must be whitelisted when
      // checking whether the raw value is read elsewhere.
      const thresholdDeclarators: EsTreeNode[] = [];
      for (let innerIndex = outerIndex + 1; innerIndex < statements.length; innerIndex++) {
        const innerStatement = statements[innerIndex];
        if (!isNodeOfType(innerStatement, "VariableDeclaration")) break;
        for (const innerDecl of innerStatement.declarations ?? []) {
          if (innerDecl.init && isThresholdComparison(innerDecl.init, continuousName)) {
            thresholdDeclarators.push(innerDecl);
          }
        }
      }
      if (thresholdDeclarators.length > 0) {
        out.push({ continuousName, hookName, declarator, thresholdDeclarators });
      }
    }
  }
  return out;
};

export const rerenderDerivedStateFromHook = defineRule({
  id: "rerender-derived-state-from-hook",
  title: "Continuous hook value over-renders",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    'Use a threshold hook like `useMediaQuery("(max-width: 767px)")`, so the screen only redraws when the answer changes, not on every pixel',
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = findThresholdDerivedBindings(componentBody);
      for (const binding of bindings) {
        if (isContinuousReferencedElsewhere(componentBody, binding)) continue;
        context.report({
          node: binding.declarator,
          message: `This redraws the screen far more than needed because ${binding.hookName}() changes constantly but you only check it against a cutoff, so use a threshold hook like \`useMediaQuery("(max-width: 767px)")\` to redraw only when the answer changes`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
