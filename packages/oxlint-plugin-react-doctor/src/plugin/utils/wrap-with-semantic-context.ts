import type { EsTreeNode } from "./es-tree-node.js";
import type { Rule } from "./rule.js";
import type { BaseRuleContext, RuleContext } from "./rule-context.js";
import type { HostRule } from "./rule-plugin.js";
import type { RuleVisitors } from "./rule-visitors.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";

// Wraps a rule so `context.scopes` and `context.cfg` exist at runtime
// even when oxlint's host context doesn't pre-build them. We build the
// scope tree and CFG lazily on first access, scoped to the AST root
// captured by the rule's Program visitor.
//
// Both analyses are pure — they only depend on the AST root — so a
// per-file rebuild is correct. Caching across calls would require
// re-running on AST mutation; not relevant for our visit-only plugin.
//
// Performance: each analysis is O(file size). For the average React
// component file (≤500 lines), the combined cost is well under 1ms.
// Files we don't visit (no rule ever reads `scopes`/`cfg`) pay nothing
// because the lazy getters never fire.
const findProgramRoot = (node: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current.type === "Program") return current;
    current = current.parent ?? null;
  }
  return null;
};

export const wrapWithSemanticContext = (rule: Rule): HostRule => ({
  ...rule,
  create: (baseContext: BaseRuleContext): RuleVisitors => {
    let programRoot: EsTreeNode | null = null;
    let cachedScopes: ScopeAnalysis | null = null;
    let cachedCfg: ControlFlowAnalysis | null = null;

    const requireProgramRoot = (): EsTreeNode => {
      if (programRoot) return programRoot;
      throw new Error("semantic context requested before Program root was captured");
    };

    const getScopes = (): ScopeAnalysis => {
      if (cachedScopes) return cachedScopes;
      cachedScopes = analyzeScopes(requireProgramRoot());
      return cachedScopes;
    };

    const getCfg = (): ControlFlowAnalysis => {
      if (cachedCfg) return cachedCfg;
      cachedCfg = analyzeControlFlow(requireProgramRoot());
      return cachedCfg;
    };

    const enrichedContext: RuleContext = {
      report: baseContext.report,
      getFilename: baseContext.getFilename,
      settings: baseContext.settings,
      get scopes() {
        return getScopes();
      },
      get cfg() {
        return getCfg();
      },
    };

    const captureRootIfNeeded = (node: EsTreeNode): void => {
      if (programRoot) return;
      programRoot = findProgramRoot(node);
    };

    const visitors = rule.create(enrichedContext);
    const wrappedVisitors: RuleVisitors = {};
    for (const [nodeType, handler] of Object.entries(visitors)) {
      if (typeof handler !== "function") continue;
      wrappedVisitors[nodeType] = ((node: EsTreeNode) => {
        captureRootIfNeeded(node);
        handler(node);
      }) as RuleVisitors[string];
    }

    // Always observe Program so the root is captured deterministically
    // before any other visitor reads scopes / cfg.
    if (!visitors.Program) {
      wrappedVisitors.Program = (node: EsTreeNode) => {
        captureRootIfNeeded(node);
      };
    }

    return wrappedVisitors;
  },
});
