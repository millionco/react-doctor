import type { ReportDescriptor } from "./report-descriptor.js";
import type {
  ControlFlowAnalysis,
  DefiniteAssignmentAnalysis,
  SsaAnalysis,
  TypestateViolation,
  VerifyTypestateOptions,
} from "@react-doctor/cfg";
import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

// The typestate engine, scoped to the file's CFGs: a rule supplies an
// automaton + event classifier and gets back the protocol violations in a
// function-like (or the Program). Returns [] when the function has no CFG.
export interface TypestateContext {
  readonly verify: (
    functionLike: EsTreeNode,
    options: VerifyTypestateOptions,
  ) => ReadonlyArray<TypestateViolation>;
}

// The "base" context the host (oxlint at runtime, ESLint via the
// adapter, our test harness) hands to a rule. Pure I/O surface — the
// host doesn't need to compute scope or CFG for us.
export interface BaseRuleContext {
  report: (descriptor: ReportDescriptor) => void;
  // Absolute path of the file being linted. Both oxlint and ESLint 9+
  // expose this as a property and deprecate `getFilename()`:
  // https://eslint.org/blog/2023/09/preparing-custom-rules-eslint-v9/#context-methods-becoming-properties
  readonly filename?: string;
  /**
   * @deprecated Rules use `context.filename`. Read only as a fallback by
   * `wrapWithSemanticContext`; ESLint implements it as a `this`-bound class
   * method, so it must be called on the host context, never a detached
   * reference.
   */
  getFilename?: () => string | undefined;
  readonly settings?: Readonly<Record<string, unknown>>;
}

// The rule-facing context. `filename` is resolved by
// `wrapWithSemanticContext` from the host's `filename` property (or its
// deprecated `getFilename()` fallback), so rules never touch `getFilename`
// directly. `scopes` / `cfg` are guaranteed non-null because every rule is
// wrapped at plugin load time. Tests pass a fully-built context via run-rule.ts.
export interface RuleContext extends Omit<BaseRuleContext, "getFilename"> {
  readonly scopes: ScopeAnalysis;
  readonly cfg: ControlFlowAnalysis;
  // Variable-level SSA over the file, sharing the scope analyzer's binding
  // identities. Built lazily; rules that never read it pay nothing.
  readonly ssa: SsaAnalysis;
  // Definite-assignment dataflow (Layer A): which reads can be reached with
  // the binding still unassigned. Lazy; opt-in.
  readonly dataflow: DefiniteAssignmentAnalysis;
  // Typestate protocol verification (Layer C). Lazy; opt-in.
  readonly typestate: TypestateContext;
}
