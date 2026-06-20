import { analyzeControlFlow } from "../src/control-flow-graph.js";
import type { FunctionCfg } from "../src/ir/basic-block.js";
import { isAstNode } from "../src/ast/is-ast-node.js";
import { isFunctionLike } from "../src/ast/is-function-like.js";
import { isNodeOfType } from "../src/ast/is-node-of-type.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";
import type {
  ResourceEvent,
  TypestateClassifier,
  TypestateViolation,
} from "../src/typestate/verify.js";
import { verifyTypestate } from "../src/typestate/verify.js";
import type { TypestateAutomaton } from "../src/typestate/automaton.js";
import { analyzeSsa } from "../src/ssa.js";
import { ssaValueResolver } from "../src/path/ssa-value-atom.js";
import type { ResolveValueAtom } from "../src/path/path-condition.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";

// An open→closed protocol: `open(r)` acquires, `close(r)` releases. Illegal
// events (close-before-open, double-open, double-close) reach the error
// state; a resource left `opened` at exit leaks.
export const openCloseAutomaton: TypestateAutomaton = {
  initial: "initial",
  transition: (state, event) => {
    if (event === "open") return state === "opened" ? "error" : "opened";
    if (event === "close") return state === "opened" ? "closed" : "error";
    return state;
  },
  errorStates: new Set(["error"]),
  acceptingStates: new Set(["initial", "closed"]),
};

// Classifies `open(x)` / `close(x)` calls anywhere in an instruction's
// subtree, keyed by the argument identifier.
export const openCloseClassifier: TypestateClassifier = (instructionNode) => {
  const events: ResourceEvent[] = [];
  const visit = (node: EsTreeNode): void => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      (node.callee.name === "open" || node.callee.name === "close")
    ) {
      const argument = node.arguments[0];
      if (argument && isNodeOfType(argument as EsTreeNode, "Identifier")) {
        events.push({
          resource: (argument as { name: string }).name,
          event: node.callee.name,
          node,
        });
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(instructionNode);
  return events;
};

const firstFunctionCfg = (program: EsTreeNode): FunctionCfg => {
  const controlFlow = analyzeControlFlow(program);
  let found: FunctionCfg | null = null;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (isFunctionLike(node)) {
      found = controlFlow.cfgFor(node);
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(program);
  const cfg = found ?? controlFlow.cfgFor(program);
  if (!cfg) throw new Error("fixture has no CFG");
  return cfg;
};

// Verifies the open/close protocol over the first function in `code` (or the
// Program if there is none). When `withFeasibility` is set, the Layer D
// path-feasibility refinement is wired in (resolving SSA values to atoms), so
// leaks whose only leaking path is provably infeasible are suppressed.
export const verifyOpenClose = (code: string, withFeasibility = false): TypestateViolation[] => {
  const parsed = parseFixture(code);
  if (parsed.errors.length > 0) {
    throw new Error(`typestate fixture failed to parse: ${parsed.errors[0]?.message}`);
  }
  attachParentReferences(parsed.program);
  const cfg = firstFunctionCfg(parsed.program);
  let resolveValue: ResolveValueAtom | undefined;
  if (withFeasibility) {
    resolveValue = ssaValueResolver(analyzeSsa(parsed.program));
  }
  return verifyTypestate(cfg, {
    automaton: openCloseAutomaton,
    classifier: openCloseClassifier,
    resolveValue,
  });
};
