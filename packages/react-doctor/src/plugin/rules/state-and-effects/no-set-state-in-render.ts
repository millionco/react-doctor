import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: an UNCONDITIONAL setter call at a component's render path
// triggers an infinite re-render loop ("Maximum update depth exceeded").
// We only flag the obvious shape — `setX(...)` as a top-level
// ExpressionStatement directly inside the component body — to avoid
// false positives on the canonical React pattern that conditionally
// updates state during render to derive from props (see
// https://react.dev/reference/react/useState#storing-information-from-previous-renders):
//
//   if (prevCount !== count) {
//     setPrevCount(count);  // ← legitimate, reaches a fixed point
//   }
//
// Conditional / loop / try-catch nesting is opaque enough that we'd
// rather miss the bug than scream at idiomatic code.
const isUnconditionalSetterCallStatement = (
  statement: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNode | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = statement.expression;
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const callee = expression.callee;
  if (!isNodeOfType(callee, "Identifier")) return null;
  if (!setterNames.has(callee.name)) return null;
  return expression;
};

export const noSetStateInRender = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Move the setter call into a `useEffect`, an event handler, or replace the state with a value computed during render. Calling a setter at render time triggers another render, which calls the setter again — an infinite loop",
  examples: [
    {
      before:
        "function Page() {\n  const [c, setC] = useState(0);\n  setC(c + 1);\n  return <div>{c}</div>;\n}",
      after:
        "function Page() {\n  const [c, setC] = useState(0);\n  const onClick = () => setC(c + 1);\n  return <button onClick={onClick}>{c}</button>;\n}",
    },
  ],
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const setterNames = new Set(
        collectUseStateBindings(componentBody).map((binding) => binding.setterName),
      );
      if (setterNames.size === 0) return;

      for (const statement of componentBody.body ?? []) {
        const setterCall = isUnconditionalSetterCallStatement(statement, setterNames);
        if (!setterCall) continue;
        if (!isNodeOfType(setterCall, "CallExpression")) continue;
        if (!isNodeOfType(setterCall.callee, "Identifier")) continue;
        const setterIdentifierName = setterCall.callee.name;
        context.report({
          node: setterCall,
          message: `${setterIdentifierName}() called unconditionally at the top of render — causes an infinite re-render loop. Move into a useEffect or an event handler. (To derive state from props, guard the call: \`if (prev !== prop) ${setterIdentifierName}(prop)\`)`,
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
