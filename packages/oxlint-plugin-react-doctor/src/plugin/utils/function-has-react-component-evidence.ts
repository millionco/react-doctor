import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionContainsProvenReactHookCall } from "./function-contains-proven-react-hook-call.js";
import { functionContainsReactRenderOutput } from "./function-contains-react-render-output.js";
import { functionReturnsOnlyNull } from "./function-returns-only-null.js";
import { functionReturnsPropsChildren } from "./function-returns-props-children.js";

export const functionHasReactComponentEvidence = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
): boolean =>
  functionContainsReactRenderOutput(functionNode, scopes, controlFlow) ||
  functionReturnsPropsChildren(functionNode, scopes, controlFlow) ||
  (functionContainsProvenReactHookCall(functionNode, scopes) &&
    functionReturnsOnlyNull(functionNode));
