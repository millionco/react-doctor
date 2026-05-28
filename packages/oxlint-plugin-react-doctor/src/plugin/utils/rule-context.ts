import type { ReportDescriptor } from "./report-descriptor.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

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
}
