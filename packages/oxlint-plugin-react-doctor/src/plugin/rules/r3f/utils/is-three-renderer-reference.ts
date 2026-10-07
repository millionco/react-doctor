import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";

const THREE_RENDERER_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "WebGLRenderer",
  "WebGPURenderer",
]);

export const isThreeRendererReference = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  THREE_RENDERER_CONSTRUCTOR_NAMES.has(getThreeConstructorName(expression, scopes) ?? "");
