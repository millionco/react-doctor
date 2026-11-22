import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

// Use this gate on the entire linted Program before attempting native attachment proof.
// A file that fails the semantic proof today can pass after an external file is added.
export const mayReadNativeMeasurementGraph = (program: EsTreeNode): boolean => {
  let foundMeasurement = false;
  walkAst(program, (node) => {
    if (foundMeasurement) return false;
    if (isNodeOfType(node, "NewExpression")) {
      const callee = stripParenExpression(node.callee);
      foundMeasurement = isNodeOfType(callee, "Identifier") && callee.name === "ResizeObserver";
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      foundMeasurement =
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "getBoundingClientRect";
    }
  });
  return foundMeasurement;
};
