import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import type { Rule } from "./rule.js";
import type { BaseRuleContext, RuleContext, TypestateContext } from "./rule-context.js";
import type { HostRule } from "./rule-plugin.js";
import type { RuleVisitors } from "./rule-visitors.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import {
  analyzeControlFlow,
  analyzeDefiniteAssignment,
  analyzeSsa,
  ssaValueResolver,
  verifyTypestate,
} from "@react-doctor/cfg";
import type {
  ControlFlowAnalysis,
  DefiniteAssignmentAnalysis,
  SsaAnalysis,
} from "@react-doctor/cfg";

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
  isReachable: () => false,
  dominates: () => false,
  postDominates: () => false,
  isInsideLoop: () => false,
  isUnreachable: () => false,
  dominanceFrontier: () => [],
  isInfiniteLoopStart: () => false,
  toDot: () => null,
};

// Unreachable in practice (see the HACK note above). `isLiveValue` defaults
// to `true` so a value-flow rule reading it errs toward NOT flagging (no
// false dead-store) if the root capture ever fails.
const FALLBACK_SSA: SsaAnalysis = {
  controlFlow: FALLBACK_CFG,
  ssaFor: () => null,
  bindingOf: () => null,
  versionAt: () => null,
  reachingDefinition: () => null,
  isLiveValue: () => true,
  isRedefinedBetween: () => false,
};

// Unreachable in practice (see the HACK note above). `isMaybeUnassignedAt`
// defaults to `false` so a use-before-define rule errs toward NOT flagging
// if the root capture ever fails.
const FALLBACK_DATAFLOW: DefiniteAssignmentAnalysis = {
  isMaybeUnassignedAt: () => false,
};

export const wrapWithSemanticContext = (rule: Rule): HostRule => ({
  ...rule,
  create: (baseContext: BaseRuleContext): RuleVisitors => {
    let programRoot: EsTreeNode | null = null;
    let cachedScopes: ScopeAnalysis | null = null;
    let cachedCfg: ControlFlowAnalysis | null = null;
    let cachedSsa: SsaAnalysis | null = null;
    let cachedDataflow: DefiniteAssignmentAnalysis | null = null;

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

    // SSA shares the scope analyzer's binding identities, so a rule can
    // cross-reference `context.scopes` symbols with SSA versions.
    const getSsa = (): SsaAnalysis => {
      if (cachedSsa) return cachedSsa;
      if (!programRoot) return FALLBACK_SSA;
      const scopes = getScopes();
      cachedSsa = analyzeSsa(programRoot, (identifier) => scopes.symbolFor(identifier)?.id ?? null);
      return cachedSsa;
    };

    // Layer D seam: an SSA value read at two branches resolves to the SAME
    // atom, so the feasibility checker can refute correlated-branch
    // counterexamples. Shared by definite-assignment and typestate so both
    // only ever drop PROVABLY-infeasible false positives.
    const getResolveValue = () => ssaValueResolver(getSsa());

    // Definite-assignment shares the scope analyzer's binding identities,
    // matching the SSA occurrence stream it keys off.
    const getDataflow = (): DefiniteAssignmentAnalysis => {
      if (cachedDataflow) return cachedDataflow;
      if (!programRoot) return FALLBACK_DATAFLOW;
      const scopes = getScopes();
      cachedDataflow = analyzeDefiniteAssignment(
        programRoot,
        (identifier) => scopes.symbolFor(identifier)?.id ?? null,
        { resolveValue: getResolveValue() },
      );
      return cachedDataflow;
    };

    // Typestate verification is parameterized per rule (automaton +
    // classifier), so it can't be cached file-wide; we resolve the target
    // function's CFG and run the engine on demand. The feasibility refinement
    // rides along via `resolveValue` unless the caller already supplied one.
    const typestate: TypestateContext = {
      verify: (functionLike, options) => {
        if (!programRoot) return [];
        const cfg = getCfg().cfgFor(functionLike);
        if (!cfg) return [];
        return verifyTypestate(cfg, { resolveValue: getResolveValue(), ...options });
      },
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
      get ssa() {
        return getSsa();
      },
      get dataflow() {
        return getDataflow();
      },
      typestate,
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
