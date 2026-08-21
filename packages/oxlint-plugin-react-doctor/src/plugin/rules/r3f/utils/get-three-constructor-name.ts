import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export const getThreeConstructorName = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => resolveThreeConstructor(expression, scopes)?.constructorName ?? null;
