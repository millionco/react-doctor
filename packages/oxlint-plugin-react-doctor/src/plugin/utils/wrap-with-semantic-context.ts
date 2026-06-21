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
//
// Cross-rule sharing: every rule is wrapped, so a private per-wrapper
// cache rebuilds the scope tree / CFG / SSA / dataflow once per rule per
// file. We instead key one `SharedAnalysis` per Program ROOT node in a
// module-level WeakMap, so all rule instances over the same file reuse a
// single build (the proven in-repo pattern — see
// `get-program-analysis.ts` and `find-variable-initializer.ts`'s
// `programRootCache`). Entries die with the file's AST when the GC
// reclaims the Program node. The CFG is built once and threaded into SSA
// and definite-assignment so neither rebuilds it.
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
  isRedefinedAfter: () => false,
};

// Unreachable in practice (see the HACK note above). `isMaybeUnassignedAt`
// defaults to `false` so a use-before-define rule errs toward NOT flagging
// if the root capture ever fails.
const FALLBACK_DATAFLOW: DefiniteAssignmentAnalysis = {
  isMaybeUnassignedAt: () => false,
};

// One lazily-filled build per file, keyed by Program root. Each field is
// computed on first access by any rule and reused by every later rule over
// the same file.
interface SharedAnalysis {
  scopes?: ScopeAnalysis;
  cfg?: ControlFlowAnalysis;
  ssa?: SsaAnalysis;
  dataflow?: DefiniteAssignmentAnalysis;
}

// HACK: WeakMap keyed on the live Program node so every rule instance over
// the same file shares one scope/CFG/SSA/dataflow build. Keyed on the
// captured Program ROOT (not the rule instance) so different rules sharing a
// file hit the same entry. Entries die with the file's AST.
const analysisCache: WeakMap<EsTreeNode, SharedAnalysis> = new WeakMap();

const sharedAnalysisFor = (programRoot: EsTreeNode): SharedAnalysis => {
  let shared = analysisCache.get(programRoot);
  if (!shared) {
    shared = {};
    analysisCache.set(programRoot, shared);
  }
  return shared;
};

export const wrapWithSemanticContext = (rule: Rule): HostRule => ({
  ...rule,
  create: (baseContext: BaseRuleContext): RuleVisitors => {
    let programRoot: EsTreeNode | null = null;

    const getScopes = (): ScopeAnalysis => {
      if (!programRoot) return buildFallbackScopes();
      const shared = sharedAnalysisFor(programRoot);
      if (!shared.scopes) shared.scopes = analyzeScopes(programRoot);
      return shared.scopes;
    };

    const getCfg = (): ControlFlowAnalysis => {
      if (!programRoot) return FALLBACK_CFG;
      const shared = sharedAnalysisFor(programRoot);
      if (!shared.cfg) shared.cfg = analyzeControlFlow(programRoot);
      return shared.cfg;
    };

    // SSA shares the scope analyzer's binding identities, so a rule can
    // cross-reference `context.scopes` symbols with SSA versions. The CFG
    // built above is threaded in so SSA does not rebuild it.
    // INVARIANT: SSA construction mutates `block.phis` on the threaded CFG —
    // now the SAME CFG every `context.cfg` consumer sees. Safe because it is
    // built once per file (memoized here) and every CFG query is phi-blind
    // (only `toDot` reads phis, and no rule calls it). A future phi reader
    // would become order-dependent on whether `getSsa()` ran first.
    const getSsa = (): SsaAnalysis => {
      if (!programRoot) return FALLBACK_SSA;
      const shared = sharedAnalysisFor(programRoot);
      if (!shared.ssa) {
        const scopes = getScopes();
        shared.ssa = analyzeSsa(
          programRoot,
          (identifier) => scopes.symbolFor(identifier)?.id ?? null,
          getCfg(),
        );
      }
      return shared.ssa;
    };

    // Layer D seam: an SSA value read at two branches resolves to the SAME
    // atom, so the feasibility checker can refute correlated-branch
    // counterexamples. Shared by definite-assignment and typestate so both
    // only ever drop PROVABLY-infeasible false positives.
    const getResolveValue = () => ssaValueResolver(getSsa());

    // Definite-assignment shares the scope analyzer's binding identities,
    // matching the SSA occurrence stream it keys off. The shared CFG is
    // threaded in so this analysis does not rebuild it.
    const getDataflow = (): DefiniteAssignmentAnalysis => {
      if (!programRoot) return FALLBACK_DATAFLOW;
      const shared = sharedAnalysisFor(programRoot);
      if (!shared.dataflow) {
        const scopes = getScopes();
        shared.dataflow = analyzeDefiniteAssignment(
          programRoot,
          (identifier) => scopes.symbolFor(identifier)?.id ?? null,
          { resolveValue: getResolveValue(), controlFlow: getCfg() },
        );
      }
      return shared.dataflow;
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
