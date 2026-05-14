import { RELATED_USE_STATE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const preferUseReducer = defineRule<Rule>({
  id: "prefer-useReducer",
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Group related state: `const [state, dispatch] = useReducer(reducer, { field1, field2, ... })`",
  examples: [
    {
      before:
        "const [name, setName] = useState('');\nconst [email, setEmail] = useState('');\nconst [age, setAge] = useState(0);\nconst [step, setStep] = useState(0);\nconst [error, setError] = useState(null);",
      after:
        "const [form, dispatch] = useReducer(formReducer, { name: '', email: '', age: 0, step: 0, error: null });",
    },
  ],
  create: (context: RuleContext) => {
    const reportExcessiveUseState = (body: EsTreeNode, componentName: string): void => {
      if (!isNodeOfType(body, "BlockStatement")) return;
      let useStateCount = 0;
      for (const statement of body.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (declarator.init && isHookCall(declarator.init, "useState")) useStateCount++;
        }
      }
      if (useStateCount >= RELATED_USE_STATE_THRESHOLD) {
        context.report({
          node: body,
          message: `Component "${componentName}" has ${useStateCount} useState calls — consider useReducer for related state`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        reportExcessiveUseState(node.body, node.id.name);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        reportExcessiveUseState(node.init.body, node.id.name);
      },
    };
  },
});
