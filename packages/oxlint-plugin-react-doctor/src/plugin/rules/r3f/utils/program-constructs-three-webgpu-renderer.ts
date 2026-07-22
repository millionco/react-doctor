import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";

export const programConstructsThreeWebgpuRenderer = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): boolean => {
  let doesConstructRenderer = false;
  walkAst(program, (candidate) => {
    if (
      !doesConstructRenderer &&
      isNodeOfType(candidate, "NewExpression") &&
      getThreeConstructorName(candidate, scopes) === "WebGPURenderer"
    ) {
      doesConstructRenderer = true;
      return false;
    }
  });
  return doesConstructRenderer;
};
