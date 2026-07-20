import type { EsTreeNode } from "./es-tree-node.js";
import { findImmediatelyInvokedCallExpression } from "./find-immediately-invoked-call-expression.js";

export const isImmediatelyInvokedFunction = (functionNode: EsTreeNode): boolean =>
  Boolean(findImmediatelyInvokedCallExpression(functionNode));
