import type { ReportDescriptor } from "./report-descriptor.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";

// The "base" context the host (oxlint at runtime, ESLint via the
// adapter, our test harness) hands to a rule. Pure I/O surface — the
// host doesn't need to compute scope or CFG for us.
export interface BaseRuleContext {
  report: (descriptor: ReportDescriptor) => void;
  // Modern hosts (ESLint 9+, oxlint) expose the filename as a property —
  // prefer it over `getFilename()`, which ESLint deprecated.
  readonly filename?: string;
  // Deprecated accessor. ESLint implements it as a `this`-bound class
  // method (`getFilename() { return this.filename; }`), so it MUST be
  // called on the host context — a detached reference loses `this` and
  // returns `undefined`. It can return `undefined` regardless, so every
  // caller must coalesce before use.
  getFilename?: () => string | undefined;
  readonly settings?: Readonly<Record<string, unknown>>;
}

// The rule-facing context. Rules read `scopes` / `cfg` when they need
// them; both are guaranteed non-null because every rule is wrapped at
// plugin load time by `wrapWithSemanticContext`, which enriches the
// host's BaseRuleContext into a RuleContext with lazy scope + CFG
// builders. Tests pass a fully-built context directly via run-rule.ts.
export interface RuleContext extends BaseRuleContext {
  readonly scopes: ScopeAnalysis;
  readonly cfg: ControlFlowAnalysis;
}
