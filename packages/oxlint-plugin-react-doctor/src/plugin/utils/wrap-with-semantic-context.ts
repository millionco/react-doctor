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
// Both analyses are pure — they only depend on the AST root — and the
// host runs every rule over one shared AST per file, so the memo below
// is keyed on the Program node and shared across rules. Keeping it in a
// per-rule closure instead re-ran the full O(file) analysis once per
// scope-reading rule per file (~20% of plugin lint CPU). Entries die
// with the AST via the WeakMap.
//
// Files we don't visit (no rule ever reads `scopes`/`cfg`) pay nothing
// because the lazy getters never fire.
// HACK: the fallback scope/CFG stubs are unreachable in practice — the
// wrapper walks every visited node's parent chain on first invocation
// (see `captureRootIfNeeded` below) and the analyses are only read from
// inside visitor bodies that fire AFTER that capture. The stubs satisfy
// the type system. `isUnconditionalFromEntry` defaults to `false` (the
// conservative answer) so that if the capture ever fails,
// `rules-of-hooks` errs toward flagging a possible violation rather
// than silently allowing one.
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
};

const scopesByProgram = new WeakMap<EsTreeNode, ScopeAnalysis>();
const cfgByProgram = new WeakMap<EsTreeNode, ControlFlowAnalysis>();

export const wrapWithSemanticContext = (rule: Rule): HostRule => ({
  ...rule,
  create: (baseContext: BaseRuleContext): RuleVisitors => {
    let programRoot: EsTreeNode | null = null;

    const getScopes = (): ScopeAnalysis => {
      if (!programRoot) return buildFallbackScopes();
      let scopes = scopesByProgram.get(programRoot);
      if (!scopes) {
        scopes = analyzeScopes(programRoot);
        scopesByProgram.set(programRoot, scopes);
      }
      return scopes;
    };

    const getCfg = (): ControlFlowAnalysis => {
      if (!programRoot) return FALLBACK_CFG;
      let cfg = cfgByProgram.get(programRoot);
      if (!cfg) {
        cfg = analyzeControlFlow(programRoot);
        cfgByProgram.set(programRoot, cfg);
      }
      return cfg;
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

    const visitors = rule.create(enrichedContext);
    // Program enter fires before every other visitor, so capturing the root
    // there is enough — wrapping every visitor of every rule in a
    // capture-then-forward closure added a call per (node × rule) for
    // nothing. Every rule gets the capture: rules can consume
    // `context.scopes` through shared helpers and factories, so no static
    // marker can tell the consumers apart reliably, and the capture itself
    // is one call per rule per file. A handler that somehow ran without a
    // Program visit falls back to the conservative stubs above.
    // Copy instead of mutating: `create` may return a shared visitors
    // object (e.g. a module-level empty-visitors constant).
    const innerProgramHandler = visitors.Program;
    return {
      ...visitors,
      Program: ((node: EsTreeNode) => {
        programRoot = node;
        if (innerProgramHandler) innerProgramHandler(node);
      }) as RuleVisitors[string],
    };
  },
});
