import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
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
// HACK: the fallback scope/CFG stubs are unreachable in practice — the
// wrapper walks every visited node's parent chain on first invocation
// (see `captureRootIfNeeded` below) and the analyses are only read from
// inside visitor bodies that fire AFTER that capture. The stubs satisfy
// the type system. `isUnconditionalFromEntry` / `dominatesExit` default
// to `false` (the conservative answer) so that if the capture ever
// fails, `rules-of-hooks` errs toward flagging a possible violation
// rather than silently allowing one.
const buildFallbackScopes = (): ScopeAnalysis => ({
  rootScope: {
    id: 0,
    kind: "module",
    node: {} as EsTreeNode,
    parent: null,
    children: [],
    symbols: [],
    references: [],
    symbolsByName: new Map(),
  } as ScopeAnalysis["rootScope"],
  scopeFor: () => ({ id: 0 }) as ScopeAnalysis["rootScope"],
  ownScopeFor: () => null,
  symbolFor: () => null,
  referenceFor: () => null,
  isGlobalReference: () => false,
});

const FALLBACK_CFG: ControlFlowAnalysis = {
  cfgFor: () => null,
  enclosingFunction: () => null,
  isUnconditionalFromEntry: () => false,
  dominatesExit: () => false,
};

export const wrapWithSemanticContext = (rule: Rule): HostRule => ({
  ...rule,
  create: (baseContext: BaseRuleContext): RuleVisitors => {
    let programRoot: EsTreeNode | null = null;
    let cachedScopes: ScopeAnalysis | null = null;
    let cachedCfg: ControlFlowAnalysis | null = null;

    const getScopes = (): ScopeAnalysis => {
      if (cachedScopes) return cachedScopes;
      if (!programRoot) return buildFallbackScopes();
      cachedScopes = analyzeScopes(programRoot);
      return cachedScopes;
    };

    const getCfg = (): ControlFlowAnalysis => {
      if (cachedCfg) return cachedCfg;
      if (!programRoot) return FALLBACK_CFG;
      cachedCfg = analyzeControlFlow(programRoot);
      return cachedCfg;
    };

    // Resolve from the host's modern `filename` property, falling back to
    // its deprecated `getFilename()` invoked ON the host (so a `this`-bound
    // class method keeps its binding — forwarding a bare reference dropped
    // `this` and returned `undefined` under ESLint 9, crashing rules).
    const enrichedContext: RuleContext = {
      report: baseContext.report,
      get filename() {
        return baseContext.filename ?? baseContext.getFilename?.();
      },
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
