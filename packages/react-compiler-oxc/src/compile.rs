//! The stage-1 driver: parse a source string, build oxc semantic, enumerate the
//! top-level function-likes, lower each to HIR, and print it.
//!
//! [`lower_to_hir`] is the Rust analog of the verifier's `extractHIR` path: it
//! returns one [`LoweredFn`] per top-level component/hook/function with its name
//! and the raw post-lowering HIR dump (the parity oracle's `--hir --stage HIR`
//! output). Functions that hit a not-yet-supported construct are reported with
//! their [`LowerError`] instead of a printed body, so the harness can record
//! them as `unsupported` rather than silently miscompiling.

use std::collections::BTreeSet;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Declaration, ExportDefaultDeclarationKind, Expression, Function, FunctionBody, Statement,
    VariableDeclarator,
};
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::{GetSpan, SourceType};

use crate::build_hir::{FunctionLike, lower, lower_with_renames};
use crate::diagnostic::{Diagnostic, Diagnostics, PositionResolver};
use crate::environment::{
    Environment, EnvironmentConfig, builtin_shapes, default_globals, find_context_identifiers,
    is_hook_name,
};
use crate::hir::model::{HirFunction, ReactFunctionType};
use crate::hir::print::print_function_with_outlined;
use crate::passes::{
    PassContext, is_known_stage, optimize_props_method_calls, run_to_stage, stage_at_least,
};
use crate::suppression::filter_suppressions_that_affect_function;
use crate::type_inference::{TypeProvider, infer_types};

std::thread_local! {
    /// While set, the installed panic hook suppresses its output. Set by
    /// [`SuppressPanicOutput`] around the per-function `catch_unwind` so an
    /// expected-and-caught pipeline bail does not spam stderr.
    static SUPPRESS_PANIC: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

static QUIET_HOOK: std::sync::Once = std::sync::Once::new();

/// Install (once, process-wide) a panic hook that defers to the previous hook
/// *unless* [`SUPPRESS_PANIC`] is set on the current thread, in which case the
/// panic message is swallowed. This keeps the convert-panic-to-error path
/// (`compile_one_reactive`) silent without losing real panic diagnostics
/// elsewhere.
fn install_quiet_panic_hook() {
    QUIET_HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let suppress = SUPPRESS_PANIC.with(|s| s.get());
            if !suppress {
                previous(info);
            }
        }));
    });
}

/// RAII guard that sets [`SUPPRESS_PANIC`] for the duration of a caught pipeline
/// run and restores the prior value on drop (even across a panic unwind).
struct SuppressPanicOutput {
    previous: bool,
}

impl SuppressPanicOutput {
    fn new() -> Self {
        let previous = SUPPRESS_PANIC.with(|s| s.replace(true));
        SuppressPanicOutput { previous }
    }
}

impl Drop for SuppressPanicOutput {
    fn drop(&mut self) {
        SUPPRESS_PANIC.with(|s| s.set(self.previous));
    }
}

/// One lowered top-level function-like declaration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoweredFn {
    /// The function name, or `None` for anonymous functions.
    pub name: Option<String>,
    /// The printed raw post-lowering HIR dump, if lowering succeeded.
    pub printed: Option<String>,
    /// The lowering error, if the function used an unsupported construct.
    pub error: Option<String>,
}

/// One top-level function-like compiled all the way to its post-
/// `PruneHoistedContexts` [`ReactiveFunction`], ready for Stage 7 codegen.
///
/// Unlike [`LoweredFn`] (which carries the *printed* HIR/reactive dump), this
/// carries the structured reactive tree plus the data the emitter needs: the
/// outlined `HirFunction`s, the `uniqueIdentifiers` set returned by
/// `RenameVariables`, and the original source span of the function-like node so
/// the emitter can splice the regenerated text back over it.
#[derive(Clone, Debug)]
pub struct CompiledReactive {
    /// The function name, or `None` for anonymous functions.
    pub name: Option<String>,
    /// The post-`PruneHoistedContexts` reactive function, or `None` if the
    /// function used an unsupported construct (the emitter then leaves the
    /// original source untouched).
    pub reactive: Option<crate::reactive_scopes::ReactiveFunction>,
    /// The outlined functions produced by `OutlineFunctions`, in order. Each is
    /// independently built into a reactive function + codegen'd by the emitter
    /// with a fresh cache namespace.
    pub outlined: Vec<crate::hir::model::HirFunction>,
    /// The `uniqueIdentifiers` set from `RenameVariables` (∪ referenced globals),
    /// used by `synthesizeName` for the `$` cache binding.
    pub unique_identifiers: std::collections::HashSet<String>,
    /// The macro-operand identifier ids from `MemoizeFbtAndMacroOperandsInSameScope`
    /// (the `fbtOperands`). Codegen consults this so a string-literal JSX attribute
    /// that is an fbt/macro operand is emitted *bare* (not wrapped in a `{…}`
    /// expression container) even when it contains chars that would otherwise
    /// require wrapping (`CodegenReactiveFunction.ts` `cx.fbtOperands` check).
    pub fbt_operands: std::collections::HashSet<crate::hir::ids::IdentifierId>,
    /// The byte span `[start, end)` of the original function-like node.
    pub span: (u32, u32),
    /// Whether the original node was an arrow function (drives arrow vs
    /// `function` syntax in the emitted header).
    pub is_arrow: bool,
    /// Whether the original node was a `FunctionDeclaration` (vs. an arrow /
    /// function expression). This drives where outlined functions are inserted:
    /// `Program.ts::insertNewOutlinedFunctionNode` does `originalFn.insertAfter`
    /// for a `FunctionDeclaration` (right after the function) but
    /// `program.pushContainer('body', …)` for an (Arrow)FunctionExpression
    /// (appended to the END of the module).
    pub is_declaration: bool,
    /// The lowering error, if any (the function is left as-is in the output).
    pub error: Option<String>,
    /// Whether the function was skipped because it carries an opt-out directive
    /// (`'use no forget'` / `'use no memo'`). Unlike [`error`](Self::error), this
    /// is *not* a compilation failure: the TS `processFn` runs the function
    /// through the compiler for validation but then deliberately leaves the
    /// original AST untouched (Program.ts `processFn`, the `directives.optOut`
    /// branch). The corpus harness must therefore not classify a directive-skip
    /// as `UNSUPPORTED`.
    pub opt_out: bool,
    /// The declaration-form context the `@gating` transform needs to wrap this
    /// function (`Entrypoint/Gating.ts::insertGatedFunctionDeclaration`). `None`
    /// when gating is disabled or this node form is not gated.
    pub gating: Option<GatingInfo>,
}

/// The declaration-shape context the `@gating` transform consults to decide which
/// `insertGatedFunctionDeclaration` branch to take, plus the source-text pieces it
/// needs. Computed during target collection (`compile_to_reactive_with_options`)
/// because the wrapper shape depends on the function-like's *parent* (whether it is
/// `export default`, an `export`ed declaration, a plain declaration, or an
/// expression), which is lost once only the byte span survives.
#[derive(Clone, Debug)]
pub struct GatingInfo {
    /// The gating function to call (`opts.gating` for static, or the per-function
    /// dynamic-gating function). Determines the import + the `<name>()` call.
    pub function: ExternalFunction,
    /// The verbatim source of the original function-like node (the "unoptimized"
    /// branch / `buildFunctionExpression(fnPath.node)`).
    pub original_source: String,
    /// The declaration form, driving which `insertGatedFunctionDeclaration` branch
    /// runs.
    pub form: GatingForm,
}

/// Which `insertGatedFunctionDeclaration` rewrite a gated function takes
/// (`Gating.ts:140-194`).
#[derive(Clone, Debug)]
pub enum GatingForm {
    /// `referencedBeforeDeclaration && fnPath.isFunctionDeclaration()`
    /// (`insertAdditionalFunctionDeclaration`, Gating.ts:36-126): emit a
    /// gating-call `const`, the optimized + unoptimized function declarations, and a
    /// hoistable wrapper that dispatches via the gating result.
    FunctionDeclarationReferencedBefore {
        /// The original function name (`Foo`).
        name: String,
        /// Per-parameter "is rest element" flags, to build the wrapper's
        /// `arg0, arg1, …rest` forwarding params (Gating.ts:81-92).
        param_is_rest: Vec<bool>,
    },
    /// A non-`export default` `FunctionDeclaration` with an id (Gating.ts:165-174):
    /// replace the whole declaration statement with
    /// `[export] const <name> = <gating>() ? <compiled> : <original>;`.
    FunctionDeclarationToConst {
        /// The original function name (`Foo`).
        name: String,
        /// Whether the declaration was `export`ed (a named `export function`), so
        /// the replacement keeps the `export ` modifier.
        exported: bool,
        /// The byte span `[start, end)` of the WHOLE statement (incl. `export`),
        /// which the const replacement is spliced over (the function-node span only
        /// covers `function …`, not the `export` keyword).
        statement_span: (u32, u32),
    },
    /// `export default function <name>()` (Gating.ts:175-190): cannot be
    /// `export default const`, so emit
    /// `const <name> = <gating>() ? <compiled> : <original>;\nexport default <name>;`.
    ExportDefaultFunctionDeclaration {
        /// The original function name (`Bar`).
        name: String,
        /// The byte span `[start, end)` of the WHOLE `export default function …`
        /// statement, spliced over with the const + re-export pair.
        statement_span: (u32, u32),
    },
    /// Any other case — an arrow / function expression, including `export default
    /// <arrow>` and a memo/forwardRef callback (Gating.ts:191-192,
    /// `fnPath.replaceWith(gatingExpression)`): replace the function NODE in place
    /// (over `span`) with `<gating>() ? <compiled> : <original>`.
    ExpressionInPlace,
}

/// Opt-in memoization directives (`Program.ts` `OPT_IN_DIRECTIVES`).
pub const OPT_IN_DIRECTIVES: [&str; 2] = ["use forget", "use memo"];
/// Opt-out memoization directives (`Program.ts` `OPT_OUT_DIRECTIVES`).
pub const OPT_OUT_DIRECTIVES: [&str; 2] = ["use no forget", "use no memo"];

/// A compiler-injected import target, ported from `Entrypoint/Options.ts`'s
/// `ExternalFunctionSchema` (`{source, importSpecifierName}`). For `@gating` this
/// is the feature-flag function the wrapper calls to decide between the compiled
/// and original implementations; for `@dynamicGating` it is synthesized per
/// function from the `'use memo if(<ident>)'` directive
/// (`importSpecifierName = <ident>`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalFunction {
    /// The module the function is imported from (the import's `source`).
    pub source: String,
    /// The exported name imported from `source` (the import's `imported`). Also
    /// the default local-name hint passed to `newUid` (`Imports.ts::addImportSpecifier`).
    pub import_specifier_name: String,
}

/// `dynamicGating` Plugin option (`Options.ts` `DynamicGatingOptionsSchema` =
/// `{source}`). When set, the `'use memo if(<ident>)'` directive enables a
/// per-function gating `ExternalFunction { source, importSpecifierName: <ident> }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DynamicGatingOptions {
    /// The module the per-function gating identifier is imported from.
    pub source: String,
}

/// The `compilationMode` Plugin option (`Options.ts`). The fixture harness
/// defaults to `'all'`; `@compilationMode:"…"` first-line pragmas override it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompilationMode {
    /// Compile every top-level function classified Component/Hook/Other.
    All,
    /// Compile only semantically component/hook-like functions.
    Infer,
    /// Compile only explicit `function Component()` / `function useHook()` decls.
    Syntax,
    /// Compile only functions carrying an opt-in directive.
    Annotation,
}

/// The subset of `PluginOptions` the whole-module compiler honors from a
/// fixture's first-line pragma. Faithful to `Entrypoint/Options.ts` +
/// `Utils/TestUtils.ts::parseConfigPragmaForTests` for the options that change
/// *whether/how* code is emitted at the Program level (the only ones the corpus
/// canonical comparison can observe).
#[derive(Clone, Debug)]
pub struct ModuleOptions {
    /// `compilationMode` (default `All` — the harness default).
    pub compilation_mode: CompilationMode,
    /// `noEmit`/`outputMode: 'lint'`: run analysis but emit no compiled code
    /// (the file is returned unchanged).
    pub lint_only: bool,
    /// `customOptOutDirectives`: when set, these directive strings replace the
    /// built-in opt-out set (`Program.ts` `findDirectiveDisablingMemoization`).
    pub custom_opt_out_directives: Option<Vec<String>>,
    /// `ignoreUseNoForget`: when true, the *per-function* opt-out skip is disabled
    /// — a function carrying `'use no forget'`/`'use no memo'` is still compiled
    /// (the directive remains in the body). Does NOT affect module-scope opt-out,
    /// which `Program.ts` checks unconditionally.
    pub ignore_use_no_forget: bool,
    /// `panicThreshold` (Plugin option, `Options.ts`). The test harness's
    /// `parseConfigPragmaForTests` defaults this to `'all_errors'`, overridable by a
    /// `@panicThreshold:"…"` pragma. It governs whether a recoverable per-function
    /// `CompilerError` (e.g. an eslint-suppression skip) is *thrown* — aborting the
    /// whole babel build, so no `result.code` is emitted — or merely logged and the
    /// function left untouched (`Program.ts::handleError`). Only `'none'` makes ALL
    /// errors recoverable; `'all_errors'`/`'critical_errors'` re-throw an error-level
    /// `CompilerError`.
    pub panic_threshold: PanicThreshold,
    /// `eslintSuppressionRules` (Plugin option). When `None`, the built-in
    /// `DEFAULT_ESLINT_SUPPRESSIONS` set is used; `@eslintSuppressionRules:[…]`
    /// overrides it (an empty array disables eslint suppression detection entirely).
    pub eslint_suppression_rules: Option<Vec<String>>,
    /// `flowSuppressions` (Plugin option, default `true`). Whether Flow
    /// `$FlowFixMe[react-rule…]` suppression comments cause a skip.
    pub flow_suppressions: bool,
    /// `validateHooksUsage` environment flag (default `true`).
    pub validate_hooks_usage: bool,
    /// `validateExhaustiveMemoizationDependencies` environment flag (default `true`).
    pub validate_exhaustive_memoization_dependencies: bool,
    /// Whether the source is parsed as a *script* (`@script` pragma) rather than a
    /// module. The harness selects the parser `sourceType` from the first line —
    /// `parseSourceType(firstLine)` returns `'script'` iff it contains `@script`
    /// (`__tests__/runner/harness.ts:68-69,153`). When `true`, the runtime cache
    /// import is emitted as a `const { c: _c } = require("…")` destructure rather
    /// than an `import { c as _c } from "…"` declaration (`Imports.ts:291-313`).
    pub script_source_type: bool,
    /// `gating` Plugin option (`Options.ts`). When set (the `@gating` pragma, which
    /// the harness's `parseConfigPragmaForTests` maps to the test default
    /// `{source: 'ReactForgetFeatureFlag', importSpecifierName: 'isForgetEnabled_Fixtures'}`),
    /// every compiled function is wrapped in a gating selector calling this function
    /// (`Entrypoint/Gating.ts::insertGatedFunctionDeclaration`).
    pub gating: Option<ExternalFunction>,
    /// `dynamicGating` Plugin option (`Options.ts`). When set (the `@dynamicGating`
    /// pragma), a function carrying a `'use memo if(<ident>)'` directive gets a
    /// per-function gating function `{source, importSpecifierName: <ident>}` that
    /// takes priority over `gating` (`Program.ts::findDirectivesDynamicGating`).
    pub dynamic_gating: Option<DynamicGatingOptions>,
}

/// Marker error returned by [`build_reactive`] when `validateHooksUsage` detects a
/// Rules-of-Hooks violation. The caller distinguishes it from a genuine
/// unsupported-construct error so it can apply the TS `processFn`/`handleError`
/// recovery: a recoverable hooks error (under `@panicThreshold:"none"`) leaves the
/// function verbatim (an opt-out), exactly as the oracle emits it.
const HOOKS_VALIDATION_ERROR: &str = "hooks-validation: rules of hooks violated";

/// Marker error returned by [`build_reactive`] when `inferMutationAliasingRanges`
/// records a render-unsafe side-effect diagnostic on the top-level function — a
/// `MutateGlobal` (reassigning / mutating a variable declared outside the
/// component/hook), `MutateFrozen` (mutating a known-immutable value), or `Impure`
/// effect. The TS `appendFunctionErrors`/`shouldRecordErrors` path records these on
/// `env` (gated `!isFunctionExpression && env.enableValidations`, and
/// `enableValidations` is always true), and `runReactiveCompilerPipeline` returns
/// `Err(env.aggregateErrors())` if `env.hasErrors()` (`Pipeline.ts:527`). The
/// caller maps this to a recoverable verbatim bailout under `@panicThreshold:"none"`
/// (the only threshold under which such a fixture appears in the emitting corpus;
/// any other threshold re-throws and aborts the build, so no `result.code`).
const RENDER_SIDE_EFFECT_ERROR: &str = "render-side-effect: mutation of a value declared outside the component/hook";

/// Marker error returned by [`build_reactive`] when `validatePreservedManualMemoization`
/// records a `PreserveManualMemo` diagnostic (`Pipeline.ts:498-503`): an existing
/// `useMemo`/`useCallback` could not be preserved (inferred deps did not match the
/// source deps, a dependency may mutate later, or an originally-memoized value
/// became unmemoized). Handled identically to [`RENDER_SIDE_EFFECT_ERROR`] — a
/// recoverable verbatim bailout under `@panicThreshold:"none"`.
const PRESERVE_MEMO_ERROR: &str = "preserve-manual-memo: existing memoization could not be preserved";

/// `panicThreshold` (`Entrypoint/Options.ts` `PanicThresholdOptionsSchema`). Only
/// the subset relevant to whether a recoverable error is re-thrown is modeled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PanicThreshold {
    /// `'all_errors'` — throw on every error/diagnostic (the test harness default).
    AllErrors,
    /// `'critical_errors'` — throw only on error-level diagnostics.
    CriticalErrors,
    /// `'none'` — never throw; log and leave the function untouched.
    None,
}

impl Default for ModuleOptions {
    fn default() -> Self {
        ModuleOptions {
            compilation_mode: CompilationMode::All,
            lint_only: false,
            custom_opt_out_directives: None,
            ignore_use_no_forget: false,
            // The corpus oracle is `parseConfigPragmaForTests`, which forces
            // `panicThreshold: 'all_errors'` (Utils/TestUtils.ts).
            panic_threshold: PanicThreshold::AllErrors,
            eslint_suppression_rules: None,
            flow_suppressions: true,
            validate_hooks_usage: true,
            validate_exhaustive_memoization_dependencies: true,
            script_source_type: false,
            gating: None,
            dynamic_gating: None,
        }
    }
}

/// The harness `parseConfigPragmaForTests` test default for the complex `gating`
/// option: a bare `@gating` (no `:value`) maps to this `ExternalFunction`
/// (`Utils/TestUtils.ts::testComplexPluginOptionDefaults`).
const TEST_GATING_SOURCE: &str = "ReactForgetFeatureFlag";
const TEST_GATING_IMPORT_NAME: &str = "isForgetEnabled_Fixtures";

impl ModuleOptions {
    /// Parse the options-bearing pragmas from a fixture's first line, mirroring
    /// `parseConfigPragmaForTests` (the harness reads only `input` up to the first
    /// newline). Only the Program-level, output-affecting options are honored; all
    /// other pragmas (validations, environment flags) are ignored because they do
    /// not change the emitted module shape under the canonical comparison.
    pub fn from_source(code: &str) -> Self {
        let first_line = code.split('\n').next().unwrap_or("");
        let mut opts = ModuleOptions::default();
        // `@compilationMode:"infer"` etc. The value is a JSON-ish string.
        if let Some(value) = pragma_value(first_line, "compilationMode") {
            let v = value.trim().trim_matches('"').trim_matches('\'');
            opts.compilation_mode = match v {
                "infer" => CompilationMode::Infer,
                "syntax" => CompilationMode::Syntax,
                "annotation" => CompilationMode::Annotation,
                _ => CompilationMode::All,
            };
        }
        // `@outputMode:"lint"` or `@noEmit` -> lint-only (emit nothing).
        if let Some(value) = pragma_value(first_line, "outputMode") {
            let v = value.trim().trim_matches('"').trim_matches('\'');
            if v == "lint" {
                opts.lint_only = true;
            }
        }
        if has_bare_pragma(first_line, "noEmit") {
            opts.lint_only = true;
        }
        // `@customOptOutDirectives:["use todo memo"]` — a JSON array of strings.
        if let Some(value) = pragma_value(first_line, "customOptOutDirectives") {
            opts.custom_opt_out_directives = Some(parse_string_array(value.trim()));
        }
        // `@ignoreUseNoForget` (bare flag or `:true`): disable per-function opt-out.
        if has_bare_pragma(first_line, "ignoreUseNoForget")
            || pragma_value(first_line, "ignoreUseNoForget")
                .map(|v| v.trim().trim_matches('"') == "true")
                .unwrap_or(false)
        {
            opts.ignore_use_no_forget = true;
        }
        // `@panicThreshold:"none"` etc. (the harness default is `'all_errors'`).
        if let Some(value) = pragma_value(first_line, "panicThreshold") {
            let v = value.trim().trim_matches('"').trim_matches('\'');
            opts.panic_threshold = match v {
                "none" => PanicThreshold::None,
                "critical_errors" => PanicThreshold::CriticalErrors,
                _ => PanicThreshold::AllErrors,
            };
        }
        // `@eslintSuppressionRules:["react-hooks/rules-of-hooks", …]` — a JSON
        // array of rule names. An empty array disables eslint suppression entirely.
        if let Some(value) = pragma_value(first_line, "eslintSuppressionRules") {
            opts.eslint_suppression_rules = Some(parse_string_array(value.trim()));
        }
        // `@flowSuppressions` / `:false` (default `true`).
        if let Some(value) = pragma_value(first_line, "flowSuppressions") {
            opts.flow_suppressions = value.trim().trim_matches('"') != "false";
        }
        // `@validateHooksUsage` / `:false` (default `true`).
        if let Some(value) = pragma_value(first_line, "validateHooksUsage") {
            opts.validate_hooks_usage = value.trim().trim_matches('"') != "false";
        }
        // `@validateExhaustiveMemoizationDependencies` / `:false` (default `true`).
        if let Some(value) = pragma_value(first_line, "validateExhaustiveMemoizationDependencies") {
            opts.validate_exhaustive_memoization_dependencies =
                value.trim().trim_matches('"') != "false";
        }
        // `@script`: the harness parses the file as a script (`parseSourceType`),
        // which makes `addImportsToProgram` emit a `require(…)` destructure for the
        // runtime cache import instead of an ESM `import` declaration.
        if first_line.contains("@script") {
            opts.script_source_type = true;
        }
        // `@gating` (bare) / `@gating:{"source":"…","importSpecifierName":"…"}`.
        // `parseConfigPragmaForTests`: `gating` is in `defaultOptions`, so a bare
        // `@gating` (value null/`'true'`) maps to the test complex default
        // `{source: 'ReactForgetFeatureFlag', importSpecifierName:
        // 'isForgetEnabled_Fixtures'}`; an explicit `:{…}` value is parsed.
        if let Some(value) = pragma_value(first_line, "gating") {
            let v = value.trim();
            opts.gating = if v == "true" {
                Some(ExternalFunction {
                    source: TEST_GATING_SOURCE.to_string(),
                    import_specifier_name: TEST_GATING_IMPORT_NAME.to_string(),
                })
            } else {
                parse_external_function(v)
            };
        } else if has_bare_pragma(first_line, "gating") {
            opts.gating = Some(ExternalFunction {
                source: TEST_GATING_SOURCE.to_string(),
                import_specifier_name: TEST_GATING_IMPORT_NAME.to_string(),
            });
        }
        // `@dynamicGating:{"source":"…"}` — a JSON object. (A bare `@dynamicGating`
        // maps to `true` in `parseConfigPragmaForTests`, which fails the
        // `DynamicGatingOptionsSchema` parse; no corpus fixture uses the bare form.)
        if let Some(value) = pragma_value(first_line, "dynamicGating") {
            if let Some(source) = parse_json_string_field(value.trim(), "source") {
                opts.dynamic_gating = Some(DynamicGatingOptions { source });
            }
        }
        opts
    }
}

/// Extract `@<key>:<value>` from a pragma line (value runs to the next ` @` or
/// end of line). Mirrors `splitPragma`'s `key:value` split.
fn pragma_value(line: &str, key: &str) -> Option<String> {
    let needle = format!("@{key}:");
    let start = line.find(&needle)? + needle.len();
    let rest = &line[start..];
    // The value ends at the next ` @` (next pragma) or end of line.
    let end = rest.find(" @").unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

/// Whether `@<key>` appears as a bare flag (no `:value`).
fn has_bare_pragma(line: &str, key: &str) -> bool {
    let needle = format!("@{key}");
    let Some(idx) = line.find(&needle) else {
        return false;
    };
    // The char right after the key must not be `:` (which would make it a
    // key:value pragma) nor an identifier char (avoid prefix collisions).
    let after = line[idx + needle.len()..].chars().next();
    !matches!(after, Some(':')) && !matches!(after, Some(c) if c.is_ascii_alphanumeric())
}

/// Parse a JSON-ish array of strings, e.g. `["use todo memo","x"]`, tolerating
/// single quotes. Used for `@customOptOutDirectives`.
fn parse_string_array(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(trimmed);
    inner
        .split(',')
        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Extract a `"<field>":"<value>"` string field from a JSON-ish object literal,
/// tolerating single quotes and whitespace. Used to parse the `@gating` /
/// `@dynamicGating` pragma object values (`{"source":"…"}`). Returns `None` if the
/// field is absent.
fn parse_json_string_field(value: &str, field: &str) -> Option<String> {
    // Find the `"field"` (or `'field'`) key, then the `:` and the quoted value.
    for quote in ['"', '\''] {
        let key = format!("{quote}{field}{quote}");
        if let Some(key_idx) = value.find(&key) {
            let after = &value[key_idx + key.len()..];
            let colon = after.find(':')?;
            let rest = after[colon + 1..].trim_start();
            let mut chars = rest.char_indices();
            let (_, open) = chars.next()?;
            if open != '"' && open != '\'' {
                continue;
            }
            // Value runs to the matching closing quote (no escaping in fixtures).
            let inner = &rest[1..];
            let end = inner.find(open)?;
            return Some(inner[..end].to_string());
        }
    }
    None
}

/// Parse an `@gating` pragma object value
/// (`{"source":"…","importSpecifierName":"…"}`) into an [`ExternalFunction`],
/// mirroring `Options.ts::tryParseExternalFunction`. Returns `None` if either
/// required field is missing.
fn parse_external_function(value: &str) -> Option<ExternalFunction> {
    let source = parse_json_string_field(value, "source")?;
    let import_specifier_name = parse_json_string_field(value, "importSpecifierName")?;
    Some(ExternalFunction {
        source,
        import_specifier_name,
    })
}

/// Whether `directives` contains an opt-out directive given the active opt-out
/// set. Ports `findDirectiveDisablingMemoization`: with `customOptOutDirectives`
/// set, those replace the built-in `OPT_OUT_DIRECTIVES`.
fn has_opt_out_directive_with<'a>(
    directives: &oxc::allocator::Vec<'a, oxc::ast::ast::Directive<'a>>,
    custom: Option<&[String]>,
) -> bool {
    match custom {
        Some(custom) => directives
            .iter()
            .any(|d| custom.iter().any(|c| c == d.expression.value.as_str())),
        None => directives
            .iter()
            .any(|d| OPT_OUT_DIRECTIVES.contains(&d.expression.value.as_str())),
    }
}

/// Whether `directives` contains an opt-in directive (`'use forget'`/`'use memo'`).
fn has_opt_in_directive<'a>(
    directives: &oxc::allocator::Vec<'a, oxc::ast::ast::Directive<'a>>,
) -> bool {
    directives
        .iter()
        .any(|d| OPT_IN_DIRECTIVES.contains(&d.expression.value.as_str()))
}

/// `Program.ts::DYNAMIC_GATING_DIRECTIVE` (`^use memo if\(([^\)]*)\)$`): if
/// `value` is a `'use memo if(<inner>)'` directive, return its captured `<inner>`
/// (which runs up to the first `)`), else `None`. The directive must match the
/// whole string (anchored `^…$`).
fn dynamic_gating_directive_match(value: &str) -> Option<&str> {
    let inner = value.strip_prefix("use memo if(")?;
    // `[^\)]*` then `)` then end-of-string: the capture runs to the first `)`,
    // and that `)` must be the final char.
    let close = inner.find(')')?;
    if close != inner.len() - 1 {
        return None;
    }
    Some(&inner[..close])
}

/// The reserved words `t.isValidIdentifier` rejects (babel's `isKeyword` ∪
/// `isReservedWord(name, true)` — the ES keyword set plus the strict-mode reserved
/// words and the literals `true`/`false`/`null`). `'use memo if(true)'` is the
/// exact case the `dynamic-gating-invalid-identifier` fixture exercises.
const RESERVED_WORDS: &[&str] = &[
    // Keywords (`@babel/helper-validator-identifier` `keyword`).
    "break", "case", "catch", "continue", "debugger", "default", "do", "else",
    "finally", "for", "function", "if", "return", "switch", "throw", "try", "var",
    "const", "while", "with", "new", "this", "super", "class", "extends", "export",
    "import", "null", "true", "false", "in", "instanceof", "typeof", "void",
    "delete", // Reserved words (`reservedWords.keyword`/`strict`/`strictBind`).
    "enum", "implements", "interface", "let", "package", "private", "protected",
    "public", "static", "yield", "eval", "arguments", "await",
];

/// `t.isValidIdentifier(name)` (default `reserved: true`): a non-empty string whose
/// first char is an identifier start (`A-Za-z_$`) and whose remaining chars are
/// identifier continues (`A-Za-z0-9_$`), and which is NOT a reserved word. (Babel
/// also accepts non-ASCII identifier chars, but the corpus directives are ASCII.)
fn is_valid_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
        return false;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return false;
    }
    !RESERVED_WORDS.contains(&name)
}

/// The outcome of `Program.ts::findDirectivesDynamicGating` for a function body's
/// directives, given `opts.dynamicGating`.
enum DynamicGating {
    /// `opts.dynamicGating === null`, or no `'use memo if(…)'` directive present —
    /// `Ok(null)` (no per-function gating).
    None,
    /// Exactly one valid `'use memo if(<ident>)'` — `Ok({gating, directive})`. The
    /// per-function gating function is `{source: dynamicGating.source,
    /// importSpecifierName: <ident>}`.
    Gating(ExternalFunction),
    /// An invalid identifier (`'use memo if(true)'`) or multiple directives —
    /// `Err(error)`. `processFn` calls `handleError` and returns null (the function
    /// is left verbatim under `@panicThreshold:"none"`; under any other threshold
    /// the TS throws, so no `result.code` is emitted at all).
    Error,
}

/// Port of `Program.ts::findDirectivesDynamicGating` (`87-144`). When
/// `opts.dynamicGating` is set, scan the body's directives for the
/// `'use memo if(<ident>)'` form: a single valid identifier yields a per-function
/// gating [`ExternalFunction`], an invalid identifier or more than one directive is
/// an error, and the absence of any such directive is `None`.
fn find_directives_dynamic_gating<'a>(
    directives: &oxc::allocator::Vec<'a, oxc::ast::ast::Directive<'a>>,
    opts: &ModuleOptions,
) -> DynamicGating {
    let Some(dynamic_gating) = &opts.dynamic_gating else {
        return DynamicGating::None;
    };
    let mut any_invalid = false;
    let mut matched: Vec<&str> = Vec::new();
    for directive in directives {
        if let Some(inner) = dynamic_gating_directive_match(directive.expression.value.as_str()) {
            if is_valid_identifier(inner) {
                matched.push(inner);
            } else {
                any_invalid = true;
            }
        }
    }
    if any_invalid {
        return DynamicGating::Error;
    }
    match matched.len() {
        0 => DynamicGating::None,
        1 => DynamicGating::Gating(ExternalFunction {
            source: dynamic_gating.source.clone(),
            import_specifier_name: matched[0].to_string(),
        }),
        _ => DynamicGating::Error,
    }
}

/// Port of `Program.ts::tryFindDirectiveEnablingMemoization` (`51-67`) as a
/// tri-state. A function is enabled if it carries a basic opt-in directive
/// (`'use forget'`/`'use memo'`) OR a single valid `'use memo if(<ident>)'`
/// directive; an invalid/multiple dynamic-gating directive is an error.
enum EnablingMemoization {
    /// A basic opt-in directive, or a valid dynamic-gating directive — the function
    /// is opted in (compiled in `annotation` mode, classified Component/Hook/Other).
    Enabled,
    /// No enabling directive.
    Disabled,
    /// An invalid/multiple dynamic-gating directive — `processFn` handles the error
    /// and returns null (verbatim under `@panicThreshold:"none"`).
    Error,
}

/// `tryFindDirectiveEnablingMemoization` for a target body, honoring its
/// arrow-expression-body guard (an expression-bodied arrow has no directives).
fn target_enabling_memoization(target: &Target<'_>, opts: &ModuleOptions) -> EnablingMemoization {
    if target.is_arrow_expression_body {
        return EnablingMemoization::Disabled;
    }
    if has_opt_in_directive(&target.body.directives) {
        return EnablingMemoization::Enabled;
    }
    match find_directives_dynamic_gating(&target.body.directives, opts) {
        DynamicGating::Gating(_) => EnablingMemoization::Enabled,
        DynamicGating::None => EnablingMemoization::Disabled,
        DynamicGating::Error => EnablingMemoization::Error,
    }
}

/// The opt-out status of a target's body under the active opt-out set. Arrow
/// functions with an expression body have no directive prologue (directives only
/// exist in block statements), matching the TS `processFn`
/// `fn.node.body.type !== 'BlockStatement'` guard.
fn target_opt_out_with(target: &Target<'_>, custom: Option<&[String]>) -> bool {
    if target.is_arrow_expression_body {
        return false;
    }
    has_opt_out_directive_with(&target.body.directives, custom)
}

/// Whether a target's body carries a memoization-enabling directive — a basic
/// opt-in (`'use forget'`/`'use memo'`) OR a valid dynamic-gating
/// `'use memo if(<ident>)'` directive (`tryFindDirectiveEnablingMemoization`).
/// An invalid/multiple dynamic-gating directive is NOT an opt-in here (it is an
/// error handled separately at the emit boundary).
fn target_opt_in(target: &Target<'_>, opts: &ModuleOptions) -> bool {
    matches!(
        target_enabling_memoization(target, opts),
        EnablingMemoization::Enabled
    )
}

/// Whether the program has a module-scope opt-out directive
/// (`Program.ts` `hasModuleScopeOptOut` →
/// `findDirectiveDisablingMemoization(program.node.directives, ...)`). When set,
/// the entire file is left unchanged. Honors `customOptOutDirectives`.
pub fn has_module_scope_opt_out(code: &str, custom: Option<&[String]>) -> bool {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::tsx()).parse();
    has_opt_out_directive_with(&parsed.program.directives, custom)
}

/// Whether the program already imports `c` from the React Compiler runtime
/// module, regardless of the local alias and of other specifiers in the same
/// import. Ports `Program.ts` `hasMemoCacheFunctionImport`, which drives
/// `shouldSkipCompilation`: a file that already imports the cache function has
/// already been compiled (or hand-written against the runtime) and is left
/// untouched.
pub fn has_memo_cache_import(code: &str) -> bool {
    use oxc::ast::ast::{ImportDeclarationSpecifier, ModuleExportName, Statement};
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::tsx()).parse();
    for stmt in &parsed.program.body {
        let Statement::ImportDeclaration(import) = stmt else {
            continue;
        };
        if import.source.value.as_str() != crate::codegen::codegen_reactive_function::RUNTIME_MODULE
        {
            continue;
        }
        let Some(specifiers) = &import.specifiers else {
            continue;
        };
        for specifier in specifiers {
            if let ImportDeclarationSpecifier::ImportSpecifier(spec) = specifier {
                let imported = match &spec.imported {
                    ModuleExportName::IdentifierName(id) => id.name.as_str(),
                    ModuleExportName::IdentifierReference(id) => id.name.as_str(),
                    ModuleExportName::StringLiteral(lit) => lit.value.as_str(),
                };
                if imported == "c" {
                    return true;
                }
            }
        }
    }
    false
}

/// Parse `code`, lower every top-level function-like declaration, and run the
/// full pipeline through `PruneHoistedContexts` (Stage 7's input), returning the
/// structured [`CompiledReactive`] for each — including the source span so the
/// codegen emitter can splice the regenerated function over the original.
///
/// This exercises exactly the same pipeline as [`compile_to_stage`] at the
/// `"PruneHoistedContexts"` stage; it differs only in returning the live
/// [`ReactiveFunction`] tree rather than its printed form.
///
/// Uses the default Plugin options (`compilationMode: 'all'`, built-in opt-out
/// directives, no lint-only). Use [`compile_to_reactive_with_options`] to honor a
/// fixture's pragmas (the whole-module [`crate::codegen::compile_module`] path
/// derives those from the first line).
pub fn compile_to_reactive(code: &str, filename: &str) -> Vec<CompiledReactive> {
    compile_to_reactive_with_options(code, filename, &ModuleOptions::default())
}

/// As [`compile_to_reactive`], but honoring the Program-level [`ModuleOptions`]
/// (`compilationMode`, lint-only, custom opt-out directives) when deciding which
/// functions to compile vs. leave untouched. Faithful to
/// `Entrypoint/Program.ts::findFunctionsToCompile` + `processFn`.
pub fn compile_to_reactive_with_options(
    code: &str,
    filename: &str,
    options: &ModuleOptions,
) -> Vec<CompiledReactive> {
    let allocator = Allocator::default();
    let _ = filename;
    let source_type = SourceType::tsx();
    let parsed = Parser::new(&allocator, code, source_type).parse();
    let program = parsed.program;

    let semantic = SemanticBuilder::new().build(&program).semantic;

    let mut results = Vec::new();
    let mut targets: Vec<Target<'_>> = Vec::new();
    for statement in &program.body {
        collect_top_level(statement, &mut targets);
    }

    // When `@gating` OR `@dynamicGating` is active,
    // `getFunctionReferencedBeforeDeclarationAtTopLevel` (`Program.ts:1237`) decides
    // which compiled `FunctionDeclaration`s take the hoist-preserving Path 1 (the
    // resolution is identical for the per-function dynamic-gating function). Compute
    // the set once over the whole program: a top-level (function-parent-null)
    // *reference* to a compiled function's name occurring before its declaration. We
    // over-approximate the candidate name set with every collected
    // `FunctionDeclaration` target name; only those actually gated consult it.
    let referenced_before: std::collections::HashSet<String> = if options.gating.is_some()
        || options.dynamic_gating.is_some()
    {
        let fn_decl_names: std::collections::HashSet<String> = targets
            .iter()
            .filter_map(|t| match &t.gating_form {
                TargetGatingForm::TopLevelFunctionDeclaration { name, .. } => Some(name.clone()),
                _ => None,
            })
            .collect();
        functions_referenced_before_declaration(&program, &fn_decl_names)
    } else {
        std::collections::HashSet::new()
    };

    let custom_opt_out = options.custom_opt_out_directives.as_deref();

    // `Program.ts::compileProgram` collects React rule suppression ranges once,
    // gated on whether the compiler is itself validating both hooks usage and
    // exhaustive memo dependencies (in which case eslint suppressions are ignored —
    // see `suppression::suppression_rules`). A function affected by a suppression
    // (`filterSuppressionsThatAffectFunction`) is run through `tryCompileFunction`,
    // which returns a structured error; `processFn` then logs it (if recoverable)
    // and leaves the original source untouched.
    let active_rules = crate::suppression::suppression_rules(
        options.validate_hooks_usage,
        options.validate_exhaustive_memoization_dependencies,
        options.eslint_suppression_rules.as_deref(),
    );
    let suppressions = crate::suppression::find_program_suppressions(
        code,
        &program.comments,
        active_rules.as_deref(),
        options.flow_suppressions,
    );

    // One module-wide uid allocator for `OutlineFunctions`, seeded with the
    // program's identifiers (babel's program-scope `generateUid`). Shared across
    // every component so outlined `_temp`/`_temp2`/… names are globally unique — a
    // per-function allocator would restart at `_temp` and emit duplicate top-level
    // `function _temp` declarations across components in the same module.
    let mut uid_allocator = crate::passes::outline_functions::UidAllocator::with_reserved(
        crate::codegen::codegen_reactive_function::collect_program_names(code),
    );

    for target in targets {
        let name = target.func.id_name();
        let span = target.func.span();
        let span = (span.start, span.end);
        let is_arrow = matches!(target.func, FunctionLike::Arrow(_));
        let is_declaration = target.is_declaration;

        // A function the active compilation mode declines to compile is left
        // untouched (`getReactFunctionType` returns null → the function is not
        // queued). `annotation`/`syntax`/`infer` filter the candidate set; `all`
        // compiles every Component/Hook/Other. We model "declined" as an opt_out
        // (leave verbatim, not an error).
        if !should_compile_in_mode(&target, options) {
            results.push(skipped_result(name, span, is_arrow, is_declaration));
            continue;
        }

        // `processFn`'s first step (`tryFindDirectiveEnablingMemoization`): an
        // invalid `'use memo if(<not-an-ident>)'` or multiple dynamic-gating
        // directives is an `Err`, which `handleError` then handles by returning
        // null WITHOUT compiling (the function is left verbatim). Under any panic
        // threshold other than `'none'` the TS throws — aborting the whole babel
        // build so no `result.code` is emitted — but every corpus dynamic-gating
        // error fixture uses `@panicThreshold:"none"`, so model it as a verbatim
        // skip (NOT an UNSUPPORTED error).
        if matches!(
            target_enabling_memoization(&target, options),
            EnablingMemoization::Error
        ) {
            results.push(skipped_result(name, span, is_arrow, is_declaration));
            continue;
        }

        // Per-function opt-out (`'use no forget'` / `'use no memo'`, or a custom
        // opt-out directive): the TS `processFn` still runs the function through
        // the compiler for validation but, when an opt-out directive is present
        // and `ignoreUseNoForget` is false (the default), logs a `CompileSkip` and
        // returns null without mutating the AST. Mirror that here: leave the
        // original source untouched and flag the result as `opt_out` (NOT an
        // error) so the harness does not count it as UNSUPPORTED. When
        // `ignoreUseNoForget` is set, the opt-out is ignored and the function is
        // compiled normally (the directive remains in the emitted body).
        if !options.ignore_use_no_forget && target_opt_out_with(&target, custom_opt_out) {
            results.push(skipped_result(name, span, is_arrow, is_declaration));
            continue;
        }

        // In `annotation` mode, only functions carrying an opt-in directive are
        // emitted (`processFn`: `compilationMode === 'annotation' && optIn == null`
        // → return null). `should_compile_in_mode` already enforces this for the
        // candidate set, but keep the guard explicit at the emit boundary.
        if options.compilation_mode == CompilationMode::Annotation
            && !target_opt_in(&target, options)
        {
            results.push(skipped_result(name, span, is_arrow, is_declaration));
            continue;
        }

        // `tryCompileFunction` first checks whether any React rule suppression
        // affects this function (`filterSuppressionsThatAffectFunction`); if so it
        // returns a structured error WITHOUT compiling. `processFn` then leaves the
        // original source untouched. The suppression error is error-level, so it is
        // re-thrown unless `panicThreshold === 'none'` (we already handled the
        // `optOut != null` always-recoverable case above as a skip). A thrown error
        // aborts the whole babel build (no `result.code`), so such fixtures are not
        // in the emitting corpus — we therefore only honor the suppression skip when
        // it is recoverable. When recoverable, the function is left verbatim, just
        // like a compilation-mode skip (NOT counted as UNSUPPORTED).
        if !suppressions.is_empty()
            && options.panic_threshold == PanicThreshold::None
            && !filter_suppressions_that_affect_function(&suppressions, span.0, span.1).is_empty()
        {
            results.push(skipped_result(name, span, is_arrow, is_declaration));
            continue;
        }

        let fn_type = react_function_type(&target);
        let context = match target.func.scope_id() {
            Some(scope) => find_context_identifiers(&semantic, scope),
            None => BTreeSet::new(),
        };
        // Lower + run the full pipeline for this function, catching any panic in a
        // not-yet-fully-ported pass and converting it into a structured `error`
        // (an `unsupported` result). The spec's hard rule is that a panic must
        // never escape: a fixture that trips an unported construct (e.g. forward-
        // reference hoisting) bails gracefully here, leaving the original source
        // untouched, rather than aborting the whole compilation.
        let outcome = compile_one_reactive(
            &target,
            &semantic,
            fn_type,
            context,
            code,
            &mut uid_allocator,
        );
        match outcome {
            Ok((reactive, outlined, unique_identifiers, fbt_operands)) => {
                // Build the gating context for a successfully-compiled function
                // (`applyCompiledFunctions`'s `kind === 'original' &&
                // functionGating != null` branch). The per-function gating function
                // is `dynamicGating ?? opts.gating` (`Program.ts:760`): a valid
                // `'use memo if(<ident>)'` directive's per-function function
                // `{source: dynamicGating.source, importSpecifierName: <ident>}`
                // takes priority over the static `@gating` function.
                let dynamic_gating = match find_directives_dynamic_gating(
                    &target.body.directives,
                    options,
                ) {
                    DynamicGating::Gating(function) => Some(function),
                    _ => None,
                };
                let function_gating = dynamic_gating.or_else(|| options.gating.clone());
                let gating = function_gating.map(|function| {
                    let params = target.func.params();
                    let mut param_is_rest: Vec<bool> = vec![false; params.items.len()];
                    if params.rest.is_some() {
                        param_is_rest.push(true);
                    }
                    resolve_gating_info(
                        function,
                        &target.gating_form,
                        span,
                        code,
                        &referenced_before,
                        param_is_rest,
                    )
                });
                results.push(CompiledReactive {
                    name,
                    reactive: Some(reactive),
                    outlined,
                    unique_identifiers,
                    fbt_operands,
                    span,
                    is_arrow,
                    is_declaration,
                    error: None,
                    opt_out: false,
                    gating,
                })
            }
            Err(err) => {
                // A Rules-of-Hooks violation under `@panicThreshold:"none"` is
                // recoverable: `handleError` does not re-throw (it is neither
                // `all_errors`/`critical_errors` nor a Config error), so the
                // function is left verbatim — NOT counted as a structured error.
                // Under any other threshold the TS *throws* (aborting the whole
                // babel build, so no `result.code` is emitted); we keep it as an
                // error so such a function is never silently emitted as a (wrong)
                // compiled form.
                // A render-unsafe side effect (`MutateGlobal`/`MutateFrozen`/
                // `Impure`) or an unpreservable manual memoization
                // (`PreserveManualMemo`) is recorded as an error in the same way;
                // under `@panicThreshold:"none"` the TS `handleError` leaves the
                // function verbatim, so we model all three identically to the
                // hooks-validation case.
                if (err == HOOKS_VALIDATION_ERROR
                    || err == RENDER_SIDE_EFFECT_ERROR
                    || err == PRESERVE_MEMO_ERROR)
                    && options.panic_threshold == PanicThreshold::None
                {
                    results.push(skipped_result(name, span, is_arrow, is_declaration));
                } else {
                    results.push(CompiledReactive {
                        name,
                        reactive: None,
                        outlined: Vec::new(),
                        unique_identifiers: Default::default(),
                        fbt_operands: Default::default(),
                        span,
                        is_arrow,
                        is_declaration,
                        error: Some(err),
                        opt_out: false,
                        gating: None,
                    });
                }
            }
        }
    }

    results
}

/// `outputMode: 'lint'` source rewrite.
///
/// In lint mode the TS compiler never *emits* a compiled function (`Program.ts`
/// `processFn` returns `null` for every function). The only change visible in the
/// output is the binding-collision **scope-rename side-effect** from HIR lowering:
/// when a binding's source name collides with an already-claimed name (i.e. it
/// shadows an outer binding the compiler interned first), `HIRBuilder.ts:290-292`
/// calls `babelBinding.scope.rename(originalName, resolvedName)`, mutating the
/// original Babel AST. That mutation is then printed verbatim.
///
/// We reproduce it here: lower every function the compiler would compile (the
/// identical target-selection gates as [`compile_to_reactive_with_options`]),
/// collecting the `(symbol, resolved_name)` renames each lowering recorded, then
/// rewrite every binding/reference token of each renamed symbol in the original
/// source. Functions that bail during lowering simply contribute no renames (the
/// source is left untouched there), matching the TS where a thrown/failed compile
/// in lint mode also leaves the AST as-is.
///
/// Returns the rewritten source (unchanged when no renames fire).
pub fn lint_rename_source(code: &str, options: &ModuleOptions) -> String {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::tsx()).parse();
    let program = parsed.program;
    let semantic = SemanticBuilder::new().build(&program).semantic;

    let mut targets: Vec<Target<'_>> = Vec::new();
    for statement in &program.body {
        collect_top_level(statement, &mut targets);
    }

    let custom_opt_out = options.custom_opt_out_directives.as_deref();

    // The full set of `(symbol, new_name)` renames recorded across every compiled
    // function in the module. A symbol can only be renamed once (the binding map
    // interns it the first time), so collisions cannot disagree.
    let mut renames: Vec<(oxc::semantic::SymbolId, String)> = Vec::new();

    for target in &targets {
        // Apply the SAME target-selection gates as the emit path so the lowering
        // (and thus the rename side-effect) happens for exactly the functions the
        // TS compiler runs through `tryCompileFunction`.
        if !should_compile_in_mode(target, options) {
            continue;
        }
        if matches!(
            target_enabling_memoization(target, options),
            EnablingMemoization::Error
        ) {
            continue;
        }
        if !options.ignore_use_no_forget && target_opt_out_with(target, custom_opt_out) {
            continue;
        }
        if options.compilation_mode == CompilationMode::Annotation && !target_opt_in(target, options)
        {
            continue;
        }

        let fn_type = react_function_type(target);
        let context = match target.func.scope_id() {
            Some(scope) => find_context_identifiers(&semantic, scope),
            None => BTreeSet::new(),
        };
        // Lower only (no later passes needed — the rename side-effect happens at
        // lowering time). Catch any pipeline bail so a single unported construct
        // does not abort the whole rewrite; such a function simply contributes no
        // renames (its original source stays as-is), matching the TS lint-mode
        // behavior where a failed compile leaves the AST untouched.
        install_quiet_panic_hook();
        let _guard = SuppressPanicOutput::new();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut env = Environment::new(
                fn_type,
                EnvironmentConfig::from_source(code),
                context.clone(),
            );
            lower_with_renames(
                &target.func,
                target.body,
                target.is_arrow_expression_body,
                &semantic,
                &mut env,
                Default::default(),
                false,
            )
        }));
        if let Ok(Ok((_func, fn_renames))) = outcome {
            renames.extend(fn_renames);
        }
    }

    if renames.is_empty() {
        return code.to_string();
    }

    apply_renames_to_source(code, &semantic, &renames)
}

/// Rewrite every binding-declaration and reference token of each renamed symbol in
/// `code`, returning the new source. Mirrors Babel's `scope.rename`, which
/// rewrites the binding identifier and all of its references (expanding an object
/// shorthand `{x}` whose value is renamed into `{x: x_0}` so the property key — a
/// separate, un-renamed string — is preserved).
fn apply_renames_to_source(
    code: &str,
    semantic: &oxc::semantic::Semantic<'_>,
    renames: &[(oxc::semantic::SymbolId, String)],
) -> String {
    let scoping = semantic.scoping();
    // Collect (span, replacement) edits. `shorthand` edits replace the whole
    // shorthand property `x` with `x: x_0` (the value reference span equals the
    // key span, so a bare span replace would drop the key).
    let mut edits: Vec<(u32, u32, String)> = Vec::new();

    // Pre-index object-shorthand property identifier spans so a renamed reference
    // inside one is expanded to `key: value` rather than blindly replaced.
    let mut shorthand_spans: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    for node in semantic.nodes().iter() {
        if let oxc::ast::AstKind::ObjectProperty(prop) = node.kind() {
            if prop.shorthand {
                let key_span = prop.key.span();
                shorthand_spans.insert((key_span.start, key_span.end));
            }
        }
    }

    for (symbol, new_name) in renames {
        // The binding declaration identifier.
        let decl_span = scoping.symbol_span(*symbol);
        push_rename_edit(
            &mut edits,
            decl_span,
            new_name,
            &shorthand_spans,
            code,
        );
        // Every resolved reference.
        for &reference_id in scoping.get_resolved_reference_ids(*symbol) {
            let reference = scoping.get_reference(reference_id);
            let node_id = reference.node_id();
            let span = semantic.nodes().get_node(node_id).kind().span();
            push_rename_edit(&mut edits, span, new_name, &shorthand_spans, code);
        }
    }

    // Apply right-to-left so earlier byte offsets stay valid. Dedup identical
    // spans (a span can be both a decl and reference in pathological cases).
    edits.sort_by(|a, b| b.0.cmp(&a.0));
    edits.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
    let mut out = code.to_string();
    for (start, end, replacement) in edits {
        out.replace_range(start as usize..end as usize, &replacement);
    }
    out
}

/// Push a single rename edit for an identifier token at `span`. When the token is
/// an object-shorthand property key/value (`{x}`), expand it to `key: new_name`.
fn push_rename_edit(
    edits: &mut Vec<(u32, u32, String)>,
    span: oxc::span::Span,
    new_name: &str,
    shorthand_spans: &std::collections::HashSet<(u32, u32)>,
    code: &str,
) {
    let key = (span.start, span.end);
    if shorthand_spans.contains(&key) {
        let original = &code[span.start as usize..span.end as usize];
        edits.push((span.start, span.end, format!("{original}: {new_name}")));
    } else {
        edits.push((span.start, span.end, new_name.to_string()));
    }
}

/// A `CompiledReactive` for a function that was deliberately *not* compiled (a
/// compilation-mode skip or a per-function opt-out). The original source is left
/// untouched and the result is flagged `opt_out` so the harness does not count it
/// as UNSUPPORTED.
fn skipped_result(
    name: Option<String>,
    span: (u32, u32),
    is_arrow: bool,
    is_declaration: bool,
) -> CompiledReactive {
    CompiledReactive {
        name,
        reactive: None,
        outlined: Vec::new(),
        unique_identifiers: Default::default(),
        fbt_operands: Default::default(),
        span,
        is_arrow,
        is_declaration,
        error: None,
        opt_out: true,
        gating: None,
    }
}

/// Resolve a target's [`TargetGatingForm`] into the final [`GatingInfo`], pinning
/// the gating `function`, the verbatim original source, and the
/// referenced-before-declaration resolution (which promotes a
/// `TopLevelFunctionDeclaration` to the `insertAdditionalFunctionDeclaration`
/// Path 1 when its name is referenced before its declaration at the top level).
fn resolve_gating_info(
    function: ExternalFunction,
    target_form: &TargetGatingForm,
    span: (u32, u32),
    code: &str,
    referenced_before: &std::collections::HashSet<String>,
    param_is_rest: Vec<bool>,
) -> GatingInfo {
    let original_source = code
        .get(span.0 as usize..span.1 as usize)
        .unwrap_or("")
        .to_string();
    let form = match target_form {
        TargetGatingForm::TopLevelFunctionDeclaration {
            name,
            exported,
            statement_span,
        } => {
            if referenced_before.contains(name) {
                // Path 1: `referencedBeforeDeclaration && isFunctionDeclaration()`.
                // `insertAdditionalFunctionDeclaration` builds an `arg0, arg1,
                // …rest` forwarding param list; a rest-element param is forwarded
                // with a spread (Gating.ts:81-92).
                GatingForm::FunctionDeclarationReferencedBefore {
                    name: name.clone(),
                    param_is_rest,
                }
            } else {
                GatingForm::FunctionDeclarationToConst {
                    name: name.clone(),
                    exported: *exported,
                    statement_span: *statement_span,
                }
            }
        }
        TargetGatingForm::ExportDefaultFunctionDeclaration {
            name,
            statement_span,
        } => GatingForm::ExportDefaultFunctionDeclaration {
            name: name.clone(),
            statement_span: *statement_span,
        },
        TargetGatingForm::ExpressionInPlace => GatingForm::ExpressionInPlace,
    };
    GatingInfo {
        function,
        original_source,
        form,
    }
}

/// `getFunctionReferencedBeforeDeclarationAtTopLevel` (`Program.ts:1237-1296`):
/// the subset of `candidate_names` (compiled top-level `FunctionDeclaration`s)
/// that are *referenced* at the top-level (function-parent-null) scope BEFORE
/// their own declaration. The TS walks the program in document order, tracking
/// each candidate until it reaches the declaration id (then stops tracking); a
/// top-level referenced identifier seen before that point flags the function.
///
/// We reproduce it structurally: for each candidate name, find its
/// FunctionDeclaration's span start, then check whether any *reference* to that
/// name appears at the module top level (not nested inside another function) at a
/// source position before that start.
fn functions_referenced_before_declaration(
    program: &oxc::ast::ast::Program<'_>,
    candidate_names: &std::collections::HashSet<String>,
) -> std::collections::HashSet<String> {
    use oxc::ast::ast::Statement;

    let mut result = std::collections::HashSet::new();
    if candidate_names.is_empty() {
        return result;
    }

    // The declaration start position of each candidate function declaration.
    let mut decl_start: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for stmt in &program.body {
        let func = match stmt {
            Statement::FunctionDeclaration(f) => Some(f.as_ref()),
            Statement::ExportNamedDeclaration(e) => match &e.declaration {
                Some(Declaration::FunctionDeclaration(f)) => Some(f.as_ref()),
                _ => None,
            },
            _ => None,
        };
        if let Some(func) = func {
            if let Some(id) = &func.id {
                if candidate_names.contains(id.name.as_str()) {
                    decl_start.insert(id.name.as_str().to_string(), func.span.start);
                }
            }
        }
    }

    // Collect every top-level (module-scope) *referenced* identifier with its
    // source position. We only descend through statements/expressions that keep us
    // at the module scope — i.e. we do NOT recurse into function bodies (a
    // reference inside another top-level function has a non-null function parent).
    let mut top_level_refs: Vec<(String, u32)> = Vec::new();
    for stmt in &program.body {
        collect_top_level_references(stmt, candidate_names, &mut top_level_refs);
    }

    for (name, pos) in top_level_refs {
        if let Some(&start) = decl_start.get(&name) {
            // A reference strictly before the declaration's start → hoisted.
            if pos < start {
                result.insert(name);
            }
        }
    }

    result
}

/// Collect top-level (module-scope) referenced identifiers named in `names`,
/// WITHOUT descending into nested function bodies (those references have a
/// non-null function parent and so do not count for hoist detection). Records the
/// `(name, span.start)` of each matching reference.
fn collect_top_level_references(
    statement: &Statement<'_>,
    names: &std::collections::HashSet<String>,
    out: &mut Vec<(String, u32)>,
) {
    use oxc::ast_visit::{Visit, walk};

    struct RefCollector<'n> {
        names: &'n std::collections::HashSet<String>,
        out: &'n mut Vec<(String, u32)>,
    }
    impl<'a, 'n> Visit<'a> for RefCollector<'n> {
        fn visit_identifier_reference(&mut self, it: &oxc::ast::ast::IdentifierReference<'a>) {
            if self.names.contains(it.name.as_str()) {
                self.out.push((it.name.as_str().to_string(), it.span.start));
            }
            walk::walk_identifier_reference(self, it);
        }
        // Do not descend into nested function bodies: a reference there has a
        // non-null function parent, so it is not a top-level hoist reference.
        fn visit_function(&mut self, _it: &oxc::ast::ast::Function<'a>, _flags: oxc::semantic::ScopeFlags) {}
        fn visit_arrow_function_expression(&mut self, _it: &oxc::ast::ast::ArrowFunctionExpression<'a>) {}
    }

    let mut collector = RefCollector { names, out };
    collector.visit_statement(statement);
}

/// Whether the active [`CompilationMode`] queues this target for compilation,
/// porting `Entrypoint/Program.ts::getReactFunctionType` (returns null → skip):
///
/// - **`all`**: every function (`getComponentOrHookLike ?? 'Other'` is never
///   null), so always compile.
/// - **`infer`**: only component/hook-like functions (named + JSX/hooks + valid
///   params), or functions carrying an opt-in directive.
/// - **`syntax`**: only explicit `function Component()` / `function useHook()`
///   declarations (capitalized / hook-named *function declarations*), or opt-in.
/// - **`annotation`**: only functions carrying an opt-in directive.
fn should_compile_in_mode(target: &Target<'_>, options: &ModuleOptions) -> bool {
    // An opt-in directive (including a valid dynamic-gating `'use memo if(<ident>)'`
    // directive) forces classification as Component/Hook/Other in every mode
    // (`getReactFunctionType`: opt-ins are checked before the mode switch).
    if target_opt_in(target, options) {
        return true;
    }
    match options.compilation_mode {
        CompilationMode::All => true,
        CompilationMode::Infer => {
            // `componentSyntaxType ?? getComponentOrHookLike(fn)`. We approximate
            // `getComponentOrHookLike` with the same classification used for the
            // function type: a non-`Other` result means it is component/hook-like.
            react_function_type(target) != ReactFunctionType::Other
        }
        CompilationMode::Syntax => {
            // Only explicit component/hook *declarations* (a named function
            // declaration whose name is component- or hook-shaped).
            is_component_or_hook_declaration(target)
        }
        CompilationMode::Annotation => false, // opt-ins handled above
    }
}

/// Whether the target is an explicit component/hook function *declaration* — a
/// non-arrow function declaration whose binding name is capitalized (component)
/// or hook-named. Approximates `isComponentDeclaration`/`isHookDeclaration` for
/// the `syntax` compilation mode.
fn is_component_or_hook_declaration(target: &Target<'_>) -> bool {
    if target.is_arrow_expression_body || matches!(target.func, FunctionLike::Arrow(_)) {
        return false;
    }
    match target.binding_name.as_deref() {
        Some(name) => starts_uppercase(name) || is_hook_name(name),
        None => false,
    }
}

/// Lower one target and run the pipeline through `PruneHoistedContexts`, catching
/// any panic from a not-yet-fully-ported pass and returning it as a structured
/// `Err` (an `unsupported` outcome). Mirrors the TS compiler's per-function
/// `Result` boundary: a bail on one function does not abort the others.
fn compile_one_reactive(
    target: &Target<'_>,
    semantic: &oxc::semantic::Semantic<'_>,
    fn_type: ReactFunctionType,
    context: BTreeSet<oxc::semantic::SymbolId>,
    code: &str,
    uid_allocator: &mut crate::passes::outline_functions::UidAllocator,
) -> Result<
    (
        crate::reactive_scopes::ReactiveFunction,
        Vec<HirFunction>,
        std::collections::HashSet<String>,
        std::collections::HashSet<crate::hir::ids::IdentifierId>,
    ),
    String,
> {
    install_quiet_panic_hook();
    let _guard = SuppressPanicOutput::new();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut env = Environment::new(fn_type, EnvironmentConfig::from_source(code), context.clone());
        let mut func = lower(
            &target.func,
            target.body,
            target.is_arrow_expression_body,
            semantic,
            &mut env,
            Default::default(),
            false,
        )
        .map_err(|e| format!("{e}"))?;
        let (reactive, unique_identifiers, fbt_operands) =
            build_reactive(&mut func, &env, code, uid_allocator, None)?;
        Ok::<_, String>((reactive, func.outlined.clone(), unique_identifiers, fbt_operands))
    }));
    match result {
        Ok(inner) => inner,
        Err(_) => Err("unsupported: pipeline bailed (unported construct)".to_string()),
    }
}

/// Run the HIR + reactive pipeline through `PruneHoistedContexts` and return the
/// built [`ReactiveFunction`] plus the `RenameVariables` `uniqueIdentifiers` set.
///
/// This is the structured analog of the `BuildReactiveFunction` branch of
/// [`run_passes`]: it runs the identical pass sequence but keeps the live tree.
fn build_reactive(
    func: &mut HirFunction,
    env: &Environment,
    source: &str,
    uid_allocator: &mut crate::passes::outline_functions::UidAllocator,
    lint_sink: Option<(&PositionResolver, &mut Diagnostics)>,
) -> Result<
    (
        crate::reactive_scopes::ReactiveFunction,
        std::collections::HashSet<String>,
        std::collections::HashSet<crate::hir::ids::IdentifierId>,
    ),
    String,
> {
    let stage = "PruneHoistedContexts";
    let mut ctx = PassContext::new(env.peek_block_id(), env.peek_identifier_id());
    run_to_stage(
        func,
        &mut ctx,
        stage,
        env.config.is_memoization_validation_enabled(),
    );

    let provider = TypeProvider {
        shapes: builtin_shapes(),
        globals: default_globals(),
        enable_treat_ref_like_identifiers_as_refs: env
            .config
            .enable_treat_ref_like_identifiers_as_refs,
        enable_treat_set_identifiers_as_state_setters: env
            .config
            .enable_treat_set_identifiers_as_state_setters,
        enable_assume_hooks_follow_rules_of_react: env
            .config
            .enable_assume_hooks_follow_rules_of_react,
        enable_custom_type_definition_for_reanimated: env
            .config
            .enable_custom_type_definition_for_reanimated,
    };
    infer_types(func, &provider);

    // `validateHooksUsage` (Pipeline.ts: `enableValidations && validateHooksUsage`,
    // run after `inferTypes`). `enableValidations` is true for every output mode,
    // so the only gate is the config flag (default `true`). A Rules-of-Hooks
    // violation (conditional hook call, hook used as a value, hook called inside a
    // nested function expression) records an error in the TS, which
    // `processFn`/`handleError` then re-throws unless `@panicThreshold:"none"`. We
    // surface it as a distinguishable error string here; the caller
    // (`compile_to_reactive_with_options`) maps it to a recoverable verbatim
    // bailout when the panic threshold is `none`, matching the oracle.
    if env.config.validate_hooks_usage
        && crate::passes::validate_hooks_usage::validate_hooks_usage(func)
    {
        return Err(HOOKS_VALIDATION_ERROR.to_string());
    }

    optimize_props_method_calls::optimize_props_method_calls(func);
    let enable_preserve = env.config.enable_preserve_existing_memoization_guarantees;
    // `freezeValue`'s transitive-freeze gate:
    // `enablePreserveExistingMemoizationGuarantees || enableTransitivelyFreezeFunctionExpressions`.
    let transitively_freeze_fn_exprs =
        enable_preserve || env.config.enable_transitively_freeze_function_expressions;
    crate::passes::analyse_functions::analyse_functions(
        func,
        ctx.scope_allocator(),
        enable_preserve,
        transitively_freeze_fn_exprs,
    );
    crate::passes::infer_mutation_aliasing_effects::infer_mutation_aliasing_effects(
        func,
        false,
        enable_preserve,
        transitively_freeze_fn_exprs,
        env.config.validate_no_impure_functions_in_render,
    );
    crate::passes::dead_code_elimination::dead_code_elimination(func);
    crate::passes::prune_maybe_throws::prune_maybe_throws(func, &mut ctx);
    // `inferMutationAliasingRanges(fn, {isFunctionExpression: false})` records a
    // render-unsafe side-effect diagnostic (`MutateGlobal`/`MutateFrozen`/`Impure`)
    // on the top-level function via `appendFunctionErrors`/`shouldRecordErrors`
    // (gated `!isFunctionExpression && env.enableValidations`, the latter always
    // true). A recorded error makes `runReactiveCompilerPipeline` return `Err`
    // (`Pipeline.ts:527`'s `env.hasErrors()`). We surface that here as a
    // distinguishable error; the caller maps it to a recoverable verbatim bailout
    // under `@panicThreshold:"none"` (the only threshold under which such a fixture
    // is in the emitting corpus). The error-bearing effects appear in the returned
    // function effects only via the direct per-instruction path (a render-time
    // `StoreGlobal`/mutation), never bubbled from a nested function expression —
    // exactly the TS `shouldRecordErrors` direct path.
    let top_level_effects =
        crate::passes::infer_mutation_aliasing_ranges::infer_mutation_aliasing_ranges(func, false);
    if top_level_effects.iter().any(|e| {
        matches!(
            e,
            crate::hir::instruction::AliasingEffect::MutateGlobal { .. }
                | crate::hir::instruction::AliasingEffect::MutateFrozen { .. }
                | crate::hir::instruction::AliasingEffect::Impure { .. }
        )
    }) {
        return Err(RENDER_SIDE_EFFECT_ERROR.to_string());
    }
    crate::passes::infer_reactive_places::infer_reactive_places(func);
    crate::passes::rewrite_instruction_kinds::rewrite_instruction_kinds_based_on_reassignment(func);
    crate::passes::infer_reactive_scope_variables::infer_reactive_scope_variables(
        func,
        ctx.scope_allocator(),
    );
    let custom_macros: Vec<String> = env.config.custom_macros.clone().unwrap_or_default();
    let fbt_operands =
        crate::passes::memoize_fbt_and_macro_operands_in_same_scope::memoize_fbt_and_macro_operands_in_same_scope(
            func, &custom_macros,
        );
    if env.config.enable_jsx_outlining {
        crate::passes::outline_jsx::outline_jsx(func, &mut ctx);
    }
    // `enableNameAnonymousFunctions` (default off): synthesize `nameHint`s for
    // anonymous function expressions from their surrounding context. Runs after
    // `OutlineJSX` and before `OutlineFunctions`, mirroring `Pipeline.ts`.
    if env.config.enable_name_anonymous_functions {
        crate::passes::name_anonymous_functions::name_anonymous_functions(func);
    }
    crate::passes::outline_functions::outline_functions(func, &fbt_operands, uid_allocator);
    crate::passes::align_method_call_scopes::align_method_call_scopes(func);
    crate::passes::align_object_method_scopes::align_object_method_scopes(func);
    crate::passes::prune_unused_labels_hir::prune_unused_labels_hir(func);
    crate::passes::align_reactive_scopes_to_block_scopes_hir::align_reactive_scopes_to_block_scopes_hir(func);
    crate::passes::merge_overlapping_reactive_scopes_hir::merge_overlapping_reactive_scopes_hir(func);
    let bump =
        crate::passes::build_reactive_scope_terminals_hir::count_pre_build_postdominator_allocations(
            func,
        );
    ctx.bump_block_id(bump);
    crate::passes::build_reactive_scope_terminals_hir::build_reactive_scope_terminals_hir(
        func, &mut ctx,
    );
    crate::passes::flatten_reactive_loops_hir::flatten_reactive_loops_hir(func);
    crate::passes::flatten_scopes_with_hooks_or_use_hir::flatten_scopes_with_hooks_or_use_hir(func);
    crate::passes::propagate_scope_dependencies_hir::propagate_scope_dependencies_hir(func);
    crate::passes::propagate_scope_dependencies_hir::resolve_dependency_locations(func, source);

    let mut reactive = crate::reactive_scopes::build_reactive_function(func);
    crate::reactive_scopes::prune_unused_labels(&mut reactive);
    crate::reactive_scopes::prune_non_escaping_scopes(&mut reactive, enable_preserve);
    crate::reactive_scopes::prune_non_reactive_dependencies(&mut reactive);
    crate::reactive_scopes::prune_unused_scopes(&mut reactive);
    crate::reactive_scopes::merge_reactive_scopes_that_invalidate_together(&mut reactive);
    crate::reactive_scopes::prune_always_invalidating_scopes(&mut reactive);
    crate::reactive_scopes::propagate_early_returns(&mut reactive, &mut ctx);
    crate::reactive_scopes::prune_unused_lvalues(&mut reactive);
    crate::reactive_scopes::promote_used_temporaries(&mut reactive);
    crate::reactive_scopes::extract_scope_declarations_from_destructuring(&mut reactive, &mut ctx);
    crate::reactive_scopes::stabilize_block_ids(&mut reactive);
    let unique_identifiers = crate::reactive_scopes::rename_variables(&mut reactive);
    crate::reactive_scopes::prune_hoisted_contexts(&mut reactive);

    // `validatePreservedManualMemoization` (Pipeline.ts:498-503): run when
    // `enablePreserveExistingMemoizationGuarantees || validatePreserveExistingMemoizationGuarantees`.
    // The harness sets `validatePreserveExistingMemoizationGuarantees` from the
    // first-line pragma (default `false`, see `EnvironmentConfig`), so this runs
    // under the default `@enablePreserveExistingMemoizationGuarantees` (true) or the
    // `@validatePreserveExistingMemoizationGuarantees` pragma. A failure records a
    // `PreserveManualMemo` diagnostic on `env`; we surface it as an error that the
    // caller maps to a recoverable verbatim bailout under `@panicThreshold:"none"`
    // (`handleError`). Note this runs on the post-`pruneHoistedContexts` reactive IR
    // (before codegen), exactly matching the TS pipeline ordering.
    if env.config.enable_preserve_existing_memoization_guarantees
        || env.config.validate_preserve_existing_memoization_guarantees
    {
        match lint_sink {
            // Lint mode: collect located diagnostics rather than bailing, so the
            // `preserve-manual-memoization` rule can report the violation.
            Some((resolver, diagnostics)) => {
                crate::reactive_scopes::validate_preserved_manual_memoization_lint(
                    &reactive,
                    resolver,
                    diagnostics,
                );
            }
            None => {
                if crate::reactive_scopes::validate_preserved_manual_memoization(&reactive) {
                    return Err(PRESERVE_MEMO_ERROR.to_string());
                }
            }
        }
    }

    Ok((reactive, unique_identifiers, fbt_operands))
}

/// Parse `code`, build semantic info, and lower every top-level function-like
/// declaration to HIR. `filename` drives source-type inference
/// (`.ts`/`.tsx`/`.js`/`.jsx`). Thin wrapper over [`compile_to_stage`] at the
/// `"HIR"` stage (the raw post-lowering output, no passes run).
pub fn lower_to_hir(code: &str, filename: &str) -> Vec<LoweredFn> {
    compile_to_stage(code, filename, "HIR")
}

/// Parse `code`, lower every top-level function-like declaration to HIR, then
/// run the post-lowering pipeline passes in order up to and including `stage`,
/// printing each function. The Rust analog of the verifier's `--hir --stage
/// <stage>` path: the cleanup chain (`PruneMaybeThrows -> InlineIIFE ->
/// MergeConsecutiveBlocks`) runs for the `"MergeConsecutiveBlocks"` stage, while
/// `"HIR"` returns the raw lowering output.
///
/// An unknown stage records an error on each function rather than panicking.
pub fn compile_to_stage(code: &str, filename: &str, stage: &str) -> Vec<LoweredFn> {
    let allocator = Allocator::default();
    // The parity oracle (`capture-hir.ts`) always parses with Babel's
    // `['typescript', 'jsx']` plugins and `sourceType: 'module'`, regardless of
    // file extension — so a `.js` fixture containing JSX still parses. Mirror
    // that by forcing a TS+JSX+module source type for every input rather than
    // inferring a non-JSX type from the `.js` extension.
    let _ = filename;
    let source_type = SourceType::tsx();
    let parsed = Parser::new(&allocator, code, source_type).parse();
    let program = parsed.program;

    let semantic = SemanticBuilder::new().build(&program).semantic;

    let mut results = Vec::new();
    let mut targets: Vec<Target<'_>> = Vec::new();
    for statement in &program.body {
        collect_top_level(statement, &mut targets);
    }

    for target in targets {
        let name = target.func.id_name();
        let fn_type = react_function_type(&target);
        let context = match target.func.scope_id() {
            Some(scope) => find_context_identifiers(&semantic, scope),
            None => BTreeSet::new(),
        };
        let mut env = Environment::new(fn_type, EnvironmentConfig::from_source(code), context);
        match lower(
            &target.func,
            target.body,
            target.is_arrow_expression_body,
            &semantic,
            &mut env,
            Default::default(),
            false,
        ) {
            Ok(mut func) => match run_passes(&mut func, &env, stage, code) {
                // A `Some(reactive)` override is returned for the
                // `BuildReactiveFunction` stage (the reactive-IR dump); otherwise
                // the HIR dump is printed.
                Ok(Some(reactive)) => results.push(LoweredFn {
                    name,
                    printed: Some(reactive),
                    error: None,
                }),
                Ok(None) => results.push(LoweredFn {
                    name,
                    printed: Some(print_function_with_outlined(&func)),
                    error: None,
                }),
                Err(err) => results.push(LoweredFn {
                    name,
                    printed: None,
                    error: Some(err),
                }),
            },
            Err(err) => results.push(LoweredFn {
                name,
                printed: None,
                error: Some(format!("{err}")),
            }),
        }
    }

    results
}

/// The HIR pipeline stage after which the lint validations run, mirroring the TS
/// `Pipeline.ts` ordering: `validateNoSetStateInRender` (and its siblings) run
/// immediately after `InferMutationAliasingRanges`.
const LINT_STAGE: &str = "InferMutationAliasingRanges";

/// Run the React Compiler's lint validations over every top-level function-like
/// in `code`, returning the collected [`Diagnostic`]s bucketed by
/// [`ErrorCategory`](crate::diagnostic::ErrorCategory). This is the analysis the
/// napi `lint` binding and the JS plugin (the `react-hooks-js/*` rules) consume in
/// place of `eslint-plugin-react-hooks` / `babel-plugin-react-compiler`.
///
/// Each function is driven through the pipeline to [`LINT_STAGE`] under a
/// panic-catching guard, so an unported construct in one function bails that
/// function's analysis without aborting the whole file.
pub fn lint(code: &str, filename: &str) -> Vec<Diagnostic> {
    install_quiet_panic_hook();
    let resolver = PositionResolver::new(code);
    let allocator = Allocator::default();
    let _ = filename;
    let source_type = SourceType::tsx();
    let parsed = Parser::new(&allocator, code, source_type).parse();
    let program = parsed.program;
    let semantic = SemanticBuilder::new().build(&program).semantic;

    let mut targets: Vec<Target<'_>> = Vec::new();
    for statement in &program.body {
        collect_top_level(statement, &mut targets);
    }

    let mut diagnostics = Diagnostics::new();
    for target in targets {
        let fn_type = react_function_type(&target);
        // The React Compiler (and thus eslint-plugin-react-hooks) only compiles —
        // and therefore only lints — functions it classifies as a Component or
        // Hook (`getComponentOrHookLike`); plain functions are `Other` and never
        // produce compiler diagnostics. Skip them so the native surface matches.
        if matches!(fn_type, ReactFunctionType::Other) {
            continue;
        }
        let context = match target.func.scope_id() {
            Some(scope) => find_context_identifiers(&semantic, scope),
            None => BTreeSet::new(),
        };
        let collected = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = SuppressPanicOutput::new();
            // Lint mode turns on `validateNoImpureFunctionsInRender` so the
            // `purity` rule's `Impure` effects are emitted (the codegen path keeps
            // the default `false`, preserving corpus parity).
            let mut lint_config = EnvironmentConfig::from_source(code);
            lint_config.validate_no_impure_functions_in_render = true;
            let mut env = Environment::new(fn_type, lint_config, context.clone());
            let mut local = Diagnostics::new();
            let mut func = match lower(
                &target.func,
                target.body,
                target.is_arrow_expression_body,
                &semantic,
                &mut env,
                Default::default(),
                false,
            ) {
                Ok(func) => func,
                // A function that fails to lower is left uncompiled, exactly as the
                // React Compiler bails — surface the matching todo/unsupported
                // diagnostic for the allowlisted constructs (see above).
                Err(error) => {
                    if let Some(diagnostic) = lower_bail_diagnostic(&error, &resolver) {
                        local.push(diagnostic);
                    }
                    return local.into_vec();
                }
            };
            // `validateUseMemo` / `validateContextVariableLValues` run on the raw
            // lowered HIR, BEFORE `dropManualMemoization` rewrites the `useMemo`
            // calls away (Pipeline.ts:163-164).
            crate::passes::validate_use_memo::validate_use_memo(&func, &resolver, &mut local);
            if run_passes(&mut func, &env, LINT_STAGE, code).is_err() {
                return local.into_vec();
            }
            run_lint_validations(&func, &resolver, &mut local);

            // `validatePreservedManualMemoization` runs on the post-
            // `PruneHoistedContexts` reactive IR (Pipeline.ts), so it needs a
            // separate reactive build from a fresh lowering. A bail here just
            // skips this rule for the function.
            let mut reactive_env = Environment::new(
                fn_type,
                EnvironmentConfig::from_source(code),
                context.clone(),
            );
            if let Ok(mut reactive_func) = lower(
                &target.func,
                target.body,
                target.is_arrow_expression_body,
                &semantic,
                &mut reactive_env,
                Default::default(),
                false,
            ) {
                let mut allocator =
                    crate::passes::outline_functions::UidAllocator::with_reserved(Default::default());
                let _ = build_reactive(
                    &mut reactive_func,
                    &reactive_env,
                    code,
                    &mut allocator,
                    Some((&resolver, &mut local)),
                );
            }
            local.into_vec()
        }))
        .unwrap_or_default();
        for diagnostic in collected {
            diagnostics.push(diagnostic);
        }
    }

    diagnostics.into_vec()
}

/// Surface a *lowering* bail as a lint diagnostic, but ONLY for the specific
/// constructs whose categorization is verified to match
/// `babel-plugin-react-compiler` (the `eslint-plugin-react-hooks` oracle). The
/// Rust lowering is more conservative than babel in places (e.g. it bails on a
/// `try` without `catch`, which babel compiles), so surfacing *every* bail would
/// produce false positives. This allowlist maps the proven-matching bail kinds to
/// their babel `ErrorCategory`; everything else stays silent (a benign miss).
fn lower_bail_diagnostic(
    error: &crate::build_hir::LowerError,
    resolver: &PositionResolver,
) -> Option<Diagnostic> {
    use crate::build_hir::LowerError;
    let (category, loc, reason) = match error {
        LowerError::UnsupportedStatement { kind, loc }
            if kind == "TryStatement (with finalizer)" =>
        {
            (
                crate::diagnostic::ErrorCategory::Todo,
                loc,
                "(BuildHIR::lowerStatement) Handle TryStatement statements with finalizers",
            )
        }
        LowerError::UnsupportedStatement { kind, loc } if kind == "ForOfStatement(await)" => (
            crate::diagnostic::ErrorCategory::Todo,
            loc,
            "(BuildHIR::lowerStatement) Handle for-await-of statements",
        ),
        _ => return None,
    };
    Some(
        Diagnostic::create(category, reason)
            .with_error_detail(resolver.resolve(loc), Some(reason.to_string())),
    )
}

/// Run every ported lint validation over a function staged to [`LINT_STAGE`],
/// in the TS `Pipeline.ts` order, collecting their diagnostics. Each pass that is
/// ported emits diagnostics for its [`ErrorCategory`](crate::diagnostic::ErrorCategory);
/// the not-yet-ported categories contribute nothing (their rules surface no
/// diagnostics until the corresponding pass lands here).
fn run_lint_validations(func: &HirFunction, resolver: &PositionResolver, out: &mut Diagnostics) {
    crate::passes::validate_no_set_state_in_render::validate_no_set_state_in_render(
        func, resolver, false, out,
    );
    crate::passes::validate_no_set_state_in_effects::validate_no_set_state_in_effects(
        func, resolver, out,
    );
    crate::passes::validate_no_jsx_in_try_statement::validate_no_jsx_in_try_statement(
        func, resolver, out,
    );
    crate::passes::validate_render_side_effects::validate_render_side_effects(func, resolver, out);
    crate::passes::validate_static_components::validate_static_components(func, resolver, out);
    crate::passes::validate_incompatible_library::validate_incompatible_library(func, resolver, out);
    crate::passes::validate_hooks_usage::validate_hooks_usage_lint(func, resolver, out);
    crate::passes::validate_no_ref_access_in_render::validate_no_ref_access_in_render(
        func, resolver, out,
    );
}

/// Apply the pipeline passes to `func` up to and including `stage`, seeding the
/// [`PassContext`] from the lowering `env`'s `nextBlockId` / `nextIdentifierId`
/// counters so any synthesized blocks/temporaries continue the id sequence.
fn run_passes(
    func: &mut HirFunction,
    env: &Environment,
    stage: &str,
    source: &str,
) -> Result<Option<String>, String> {
    if !is_known_stage(stage) {
        return Err(format!("unknown stage `{stage}`"));
    }
    let mut ctx = PassContext::new(env.peek_block_id(), env.peek_identifier_id());
    run_to_stage(
        func,
        &mut ctx,
        stage,
        env.config.is_memoization_validation_enabled(),
    );

    // `InferTypes` runs after the `run_to_stage` id-allocating chain (it needs
    // the type provider, which `run_to_stage` does not carry). The provider is
    // built from the lowering environment's config + the built-in registries.
    // Every stage at or past `InferTypes` (i.e. the stage-3 passes too) needs
    // the types in place first.
    if stage_at_least(stage, "InferTypes") {
        let provider = TypeProvider {
            shapes: builtin_shapes(),
            globals: default_globals(),
            enable_treat_ref_like_identifiers_as_refs: env
                .config
                .enable_treat_ref_like_identifiers_as_refs,
            enable_treat_set_identifiers_as_state_setters: env
                .config
                .enable_treat_set_identifiers_as_state_setters,
            enable_assume_hooks_follow_rules_of_react: env
                .config
                .enable_assume_hooks_follow_rules_of_react,
            enable_custom_type_definition_for_reanimated: env
                .config
                .enable_custom_type_definition_for_reanimated,
        };
        infer_types(func, &provider);
    }

    // `OptimizePropsMethodCalls` is the first stage-3 pass: it runs right after
    // `InferTypes` (which seeds the `BuiltInProps` receiver type it keys on).
    if stage_at_least(stage, "OptimizePropsMethodCalls") {
        optimize_props_method_calls::optimize_props_method_calls(func);
    }

    // `AnalyseFunctions` recursively runs the mutation/aliasing sub-pipeline on
    // nested functions (so their effects/signatures are known), then
    // `InferMutationAliasingEffects` computes the outer function's per-instruction
    // and per-terminal aliasing effects. The nested sub-pipeline allocates scope
    // ids from the shared `nextScopeId` counter (`ctx.scope_allocator()`), so the
    // outer `InferReactiveScopeVariables` below continues from where they left off.
    let enable_preserve = env.config.enable_preserve_existing_memoization_guarantees;
    let transitively_freeze_fn_exprs =
        enable_preserve || env.config.enable_transitively_freeze_function_expressions;
    if stage_at_least(stage, "AnalyseFunctions") {
        crate::passes::analyse_functions::analyse_functions(
            func,
            ctx.scope_allocator(),
            enable_preserve,
            transitively_freeze_fn_exprs,
        );
    }
    if stage_at_least(stage, "InferMutationAliasingEffects") {
        crate::passes::infer_mutation_aliasing_effects::infer_mutation_aliasing_effects(
            func,
            false,
            enable_preserve,
            transitively_freeze_fn_exprs,
            env.config.validate_no_impure_functions_in_render,
        );
    }

    // `DeadCodeElimination` runs after the aliasing-effect inference (dead code
    // may still affect inference, hence the ordering). It is immediately followed
    // by a *second* `PruneMaybeThrows` (the first ran inside the cleanup chain) —
    // the oracle logs `PruneMaybeThrows` a second time here, which is why that
    // stage name double-logs and is never targeted for parity.
    if stage_at_least(stage, "DeadCodeElimination") {
        crate::passes::dead_code_elimination::dead_code_elimination(func);
        crate::passes::prune_maybe_throws::prune_maybe_throws(func, &mut ctx);
    }

    // `InferMutationAliasingRanges` runs after the 2nd `PruneMaybeThrows`: it
    // computes each identifier's `mutableRange` and resolves every place's
    // `effect` from `<unknown>` to a concrete `Effect` (read/store/capture/
    // mutate?/freeze/...). It is the outer function (`isFunctionExpression: false`).
    if stage_at_least(stage, "InferMutationAliasingRanges") {
        crate::passes::infer_mutation_aliasing_ranges::infer_mutation_aliasing_ranges(
            func, false,
        );
    }

    // `InferReactivePlaces` runs after the mutable-range/effect resolution: it
    // marks every `Place` that may semantically change over the component's
    // lifetime as `reactive` (rendered with the `{reactive}` suffix).
    if stage_at_least(stage, "InferReactivePlaces") {
        crate::passes::infer_reactive_places::infer_reactive_places(func);
    }

    // `RewriteInstructionKindsBasedOnReassignment` runs last in this chain:
    // it converts the first declaration of each binding to Const/Let and later
    // reassignments to Reassign (a `let` whose reassignment was DCE'd may revert
    // to `const`). Structural shape is unchanged; only `lvalue.kind` is rewritten.
    if stage_at_least(stage, "RewriteInstructionKindsBasedOnReassignment") {
        crate::passes::rewrite_instruction_kinds::rewrite_instruction_kinds_based_on_reassignment(
            func,
        );
    }

    // `InferReactiveScopeVariables` (gated on `enableMemoization`, always on in
    // the oracle's `client` output mode): assign each group of co-mutating
    // identifiers a reactive `ScopeId`, merging their `mutableRange`s into one
    // shared scope range. Prints the `_@<scopeId>` identifier suffix + merged
    // range. Draws scope ids from the same `ctx.scope_allocator()` the nested
    // functions used during `AnalyseFunctions`, so the outer function continues
    // the scope-id sequence.
    if stage_at_least(stage, "InferReactiveScopeVariables") {
        crate::passes::infer_reactive_scope_variables::infer_reactive_scope_variables(
            func,
            ctx.scope_allocator(),
        );
    }

    // `MemoizeFbtAndMacroOperandsInSameScope` forces fbt/macro operands into the
    // tag's scope and returns the set of macro-operand ids (the `fbtOperands`),
    // which `OutlineFunctions` consults. `customMacros` comes from env config
    // (`fn.env.config.customMacros ?? []`); the `idx`/`cx` fixtures set it via the
    // `@customMacros` pragma.
    let custom_macros: Vec<String> = env.config.custom_macros.clone().unwrap_or_default();
    let fbt_operands = if stage_at_least(stage, "MemoizeFbtAndMacroOperandsInSameScope") {
        crate::passes::memoize_fbt_and_macro_operands_in_same_scope::memoize_fbt_and_macro_operands_in_same_scope(
            func, &custom_macros,
        )
    } else {
        std::collections::HashSet::new()
    };

    // `OutlineJSX` (gated on `enableJsxOutlining`, default `false`): hoist runs
    // of nested JSX out of callbacks into freshly-generated top-level components.
    // Runs after `MemoizeFbtAndMacroOperandsInSameScope` and before
    // `OutlineFunctions`, mirroring the TS pipeline ordering. It has no dumpable
    // snapshot of its own (the oracle does not `log` a stage after it), so it
    // piggybacks on the `MemoizeFbtAndMacroOperandsInSameScope` boundary like the
    // pipeline does.
    if env.config.enable_jsx_outlining
        && stage_at_least(stage, "MemoizeFbtAndMacroOperandsInSameScope")
    {
        crate::passes::outline_jsx::outline_jsx(func, &mut ctx);
    }

    // `NameAnonymousFunctions` (gated on `enableNameAnonymousFunctions`, default
    // `false`): synthesize `nameHint`s for anonymous function expressions from
    // their surrounding context. Runs between `OutlineJSX` and `OutlineFunctions`
    // (`Pipeline.ts`). It has no dumpable stage of its own, so like `OutlineJSX`
    // it piggybacks on the `MemoizeFbtAndMacroOperandsInSameScope` boundary.
    if env.config.enable_name_anonymous_functions
        && stage_at_least(stage, "MemoizeFbtAndMacroOperandsInSameScope")
    {
        crate::passes::name_anonymous_functions::name_anonymous_functions(func);
    }

    // `OutlineFunctions` (gated on `enableFunctionOutlining`, default `true`):
    // hoist eligible context-free anonymous closures into top-level functions,
    // replacing the inline `FunctionExpression` with a `LoadGlobal` of the
    // generated name. NB: there is no separate dumpable `NameAnonymousFunctions`
    // stage here.
    if stage_at_least(stage, "OutlineFunctions") {
        crate::passes::outline_functions::outline_functions_standalone(func, &fbt_operands);
    }

    // `AlignMethodCallScopes`: unify a method call's result and resolved-method
    // scopes (or clear them) so they memoize together.
    if stage_at_least(stage, "AlignMethodCallScopes") {
        crate::passes::align_method_call_scopes::align_method_call_scopes(func);
    }

    // `AlignObjectMethodScopes`: align object-method values to their enclosing
    // object expression's scope.
    if stage_at_least(stage, "AlignObjectMethodScopes") {
        crate::passes::align_object_method_scopes::align_object_method_scopes(func);
    }

    // `PruneUnusedLabelsHIR`: collapse vacuous `label`/`goto`-break CFG patterns.
    if stage_at_least(stage, "PruneUnusedLabelsHIR") {
        crate::passes::prune_unused_labels_hir::prune_unused_labels_hir(func);
    }

    // `AlignReactiveScopesToBlockScopesHIR`: extend each reactive scope's range to
    // its enclosing block-scope boundaries (so a scope never straddles a control-
    // flow construct).
    if stage_at_least(stage, "AlignReactiveScopesToBlockScopesHIR") {
        crate::passes::align_reactive_scopes_to_block_scopes_hir::align_reactive_scopes_to_block_scopes_hir(func);
    }

    // `MergeOverlappingReactiveScopesHIR`: merge scopes that overlap or whose
    // instructions mutate an outer scope, so they form valid nested if-blocks.
    if stage_at_least(stage, "MergeOverlappingReactiveScopesHIR") {
        crate::passes::merge_overlapping_reactive_scopes_hir::merge_overlapping_reactive_scopes_hir(
            func,
        );
    }

    // `BuildReactiveScopeTerminalsHIR`: rewrite blocks to introduce `scope`/`goto`
    // terminals + fallthrough blocks, restore RPO, renumber, fix scope ranges.
    // The new scope blocks draw their ids from `env.nextBlockId`, which the oracle
    // advanced once per pre-Build post-dominator computation (the hooks/set-state
    // validations + `inferReactivePlaces`); pre-advance the counter to match.
    if stage_at_least(stage, "BuildReactiveScopeTerminalsHIR") {
        let bump =
            crate::passes::build_reactive_scope_terminals_hir::count_pre_build_postdominator_allocations(
                func,
            );
        ctx.bump_block_id(bump);
        crate::passes::build_reactive_scope_terminals_hir::build_reactive_scope_terminals_hir(
            func, &mut ctx,
        );
    }

    // `FlattenReactiveLoopsHIR`: convert `scope` to `pruned-scope` for scopes
    // contained within a loop construct.
    if stage_at_least(stage, "FlattenReactiveLoopsHIR") {
        crate::passes::flatten_reactive_loops_hir::flatten_reactive_loops_hir(func);
    }

    // `FlattenScopesWithHooksOrUseHIR`: prune/flatten scopes that transitively
    // call a hook or the `use` operator (they cannot be memoized conditionally).
    if stage_at_least(stage, "FlattenScopesWithHooksOrUseHIR") {
        crate::passes::flatten_scopes_with_hooks_or_use_hir::flatten_scopes_with_hooks_or_use_hir(
            func,
        );
    }

    // `PropagateScopeDependenciesHIR`: compute each scope's reactive dependencies,
    // declarations, and reassignments.
    if stage_at_least(stage, "PropagateScopeDependenciesHIR") {
        crate::passes::propagate_scope_dependencies_hir::propagate_scope_dependencies_hir(func);
        // Resolve each scope dependency's byte-span `loc` into Babel-style
        // line/column (the only HIR dump rendering `printSourceLocation` as
        // `start.line:start.column:end.line:end.column`). Done here because the
        // source text lives at this level, keeping the pass entry point
        // source-free per its frozen signature.
        crate::passes::propagate_scope_dependencies_hir::resolve_dependency_locations(
            func, source,
        );
    }

    // `BuildReactiveFunction` (stage 5): convert the post-
    // `PropagateScopeDependenciesHIR` HIR control-flow graph into the nested,
    // scoped `ReactiveFunction` tree and print it via
    // `printReactiveFunctionWithOutlined`. Outlined functions are appended as
    // `\nfunction <printFunction(outlined)>` blocks (the same source the TS reads
    // from `fn.env.getOutlinedFunctions()`), so they are printed with the HIR
    // `print_function` here and handed to the reactive printer.
    // `BuildReactiveFunction` (stage 5) and the stage-6 ReactiveFunction passes
    // operate on the `ReactiveFunction` tree. Build it once, then run the reactive
    // passes in pipeline order up to and including `stage`, and print via
    // `printReactiveFunctionWithOutlined`.
    if stage_at_least(stage, "BuildReactiveFunction") {
        let mut reactive = crate::reactive_scopes::build_reactive_function(func);

        // `PruneUnusedLabels`: flatten/strip unnecessary terminal labels.
        if stage_at_least(stage, "PruneUnusedLabels") {
            crate::reactive_scopes::prune_unused_labels(&mut reactive);
        }
        // `PruneNonEscapingScopes`: the memoization escape analysis — inline
        // scopes whose declarations/reassignments do not escape.
        if stage_at_least(stage, "PruneNonEscapingScopes") {
            crate::reactive_scopes::prune_non_escaping_scopes(&mut reactive, enable_preserve);
        }
        // `PruneNonReactiveDependencies`: drop scope dependencies that are not
        // reactive, propagating reactivity to surviving scopes' outputs.
        if stage_at_least(stage, "PruneNonReactiveDependencies") {
            crate::reactive_scopes::prune_non_reactive_dependencies(&mut reactive);
        }
        // `PruneUnusedScopes`: convert output-free scopes into `pruned-scope`
        // blocks.
        if stage_at_least(stage, "PruneUnusedScopes") {
            crate::reactive_scopes::prune_unused_scopes(&mut reactive);
        }
        // `MergeReactiveScopesThatInvalidateTogether`: merge consecutive/nested
        // scopes that always invalidate together to reduce memoization overhead.
        if stage_at_least(stage, "MergeReactiveScopesThatInvalidateTogether") {
            crate::reactive_scopes::merge_reactive_scopes_that_invalidate_together(&mut reactive);
        }
        // `PruneAlwaysInvalidatingScopes`: prune scopes that depend on an
        // unmemoized always-invalidating value (they would always invalidate).
        if stage_at_least(stage, "PruneAlwaysInvalidatingScopes") {
            crate::reactive_scopes::prune_always_invalidating_scopes(&mut reactive);
        }
        // `PropagateEarlyReturns`: rewrite early returns within reactive scopes to
        // an assign+break, synthesizing temporaries/labels from the shared id
        // allocators (`env.nextIdentifierId` / `env.nextBlockId`).
        if stage_at_least(stage, "PropagateEarlyReturns") {
            crate::reactive_scopes::propagate_early_returns(&mut reactive, &mut ctx);
        }
        // `PruneUnusedLValues`: null out unnamed-temporary lvalues never read later.
        if stage_at_least(stage, "PruneUnusedLValues") {
            crate::reactive_scopes::prune_unused_lvalues(&mut reactive);
        }
        // `PromoteUsedTemporaries`: promote unnamed temporaries used as scope
        // deps/decls, JSX tags, or interposed values to `#t…`/`#T…` names.
        if stage_at_least(stage, "PromoteUsedTemporaries") {
            crate::reactive_scopes::promote_used_temporaries(&mut reactive);
        }
        // `ExtractScopeDeclarationsFromDestructuring`: split mixed
        // declaration/reassignment destructurings so scope variables are
        // reassigned via a separate instruction (uses the shared id allocator for
        // the extracted temporaries).
        if stage_at_least(stage, "ExtractScopeDeclarationsFromDestructuring") {
            crate::reactive_scopes::extract_scope_declarations_from_destructuring(
                &mut reactive,
                &mut ctx,
            );
        }
        // `StabilizeBlockIds`: renumber referenced labels / break-continue targets
        // to a stable sequential 0..N.
        if stage_at_least(stage, "StabilizeBlockIds") {
            crate::reactive_scopes::stabilize_block_ids(&mut reactive);
        }
        // `RenameVariables`: rename all named identifiers to collision-free names
        // (`#t…`→`t0`, `#T…`→`T0`, `foo`→`foo$1` on collision). Returns the
        // `uniqueIdentifiers` set (∪ referenced globals) that codegen (Stage 7)
        // consumes; captured here so the data stays accessible at the call site.
        let _unique_identifiers = if stage_at_least(stage, "RenameVariables") {
            Some(crate::reactive_scopes::rename_variables(&mut reactive))
        } else {
            None
        };
        // `PruneHoistedContexts`: remove `DeclareContext HoistedConst` instructions
        // and rewrite scope-declared `StoreContext` let/const/function to Reassign.
        if stage_at_least(stage, "PruneHoistedContexts") {
            crate::reactive_scopes::prune_hoisted_contexts(&mut reactive);
        }

        let outlined: Vec<String> = func
            .outlined
            .iter()
            .map(crate::hir::print::print_function)
            .collect();
        let printed =
            crate::reactive_scopes::print_reactive_function_with_outlined(&reactive, &outlined);
        return Ok(Some(printed));
    }

    Ok(None)
}

/// A top-level function-like target plus its body and arrow-expression flag.
struct Target<'a> {
    func: FunctionLike<'a, 'a>,
    body: &'a FunctionBody<'a>,
    is_arrow_expression_body: bool,
    /// The function's name per `getFunctionName` (declaration id, or the
    /// `const NAME = ...` / `export default …` binding name). Drives the
    /// component/hook classification in [`react_function_type`].
    binding_name: Option<String>,
    /// Whether this function-like is the direct callback argument of a
    /// `React.memo(...)` / `React.forwardRef(...)` (or bare `memo`/`forwardRef`)
    /// call. `Program.ts::getComponentOrHookLike` classifies such an otherwise-
    /// anonymous `(Arrow)FunctionExpression` as a `Component` when it calls hooks
    /// or creates JSX (`isMemoCallback`/`isForwardRefCallback`).
    is_component_argument: bool,
    /// Whether the original node is a `FunctionDeclaration` (drives outlined-
    /// function insertion site — see [`CompiledReactive::is_declaration`]).
    is_declaration: bool,
    /// The declaration-form precursor the `@gating` transform uses to pick its
    /// `insertGatedFunctionDeclaration` branch — minus the program-wide
    /// `referencedBeforeDeclaration` resolution + the gating function, which are
    /// filled in once gating is known to be active.
    gating_form: TargetGatingForm,
}

/// The declaration-form a target's `@gating` wrapper takes, as far as can be known
/// from the target's own statement (without the program-wide
/// referenced-before-declaration analysis). Resolved into a [`GatingForm`] in
/// `compile_to_reactive_with_options`.
#[derive(Clone, Debug)]
enum TargetGatingForm {
    /// A non-`export default` top-level `FunctionDeclaration` with an id: becomes
    /// `[export] const <name> = …` UNLESS it is referenced-before-declaration (then
    /// it takes the `insertAdditionalFunctionDeclaration` path).
    TopLevelFunctionDeclaration {
        name: String,
        exported: bool,
        statement_span: (u32, u32),
    },
    /// `export default function <name>()`: becomes `const <name> = …; export default
    /// <name>;` (an `export default` cannot be referenced, so never Path 1).
    ExportDefaultFunctionDeclaration {
        name: String,
        statement_span: (u32, u32),
    },
    /// Anything else — an arrow / function expression replaced in place.
    ExpressionInPlace,
}

/// Collect the top-level function-likes of a statement, mirroring the printer's
/// `render_top_level` enumeration (function declarations, `const f = () => ...`,
/// and the function-valued export forms).
fn collect_top_level<'a>(statement: &'a Statement<'a>, out: &mut Vec<Target<'a>>) {
    match statement {
        Statement::FunctionDeclaration(func) => {
            push_function(func, out, fn_decl_form(func, statement.span(), false));
        }
        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                push_declarator(declarator, out);
            }
        }
        Statement::ExportNamedDeclaration(export) => {
            if let Some(declaration) = &export.declaration {
                collect_declaration(declaration, out, statement.span());
            }
        }
        Statement::ExportDefaultDeclaration(export) => match &export.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                let form = match &func.id {
                    Some(id) => TargetGatingForm::ExportDefaultFunctionDeclaration {
                        name: id.name.as_str().to_string(),
                        statement_span: (statement.span().start, statement.span().end),
                    },
                    // `export default function () {}` (anonymous) cannot be named,
                    // so it falls through to the in-place expression replacement.
                    None => TargetGatingForm::ExpressionInPlace,
                };
                push_function(func, out, form);
            }
            expression => {
                if let Some(expr) = expression.as_expression() {
                    push_expression(None, expr, out);
                }
            }
        },
        // A bare `React.memo(props => ...)` / `React.forwardRef(props => ...)`
        // call statement: the callback is at the top level (its scope parent is
        // the program), so `findFunctionsToCompile` visits it. We only descend
        // into the memo/forwardRef callback (not arbitrary call arguments), since
        // those are the only inline-argument functions `getComponentOrHookLike`
        // classifies as a Component.
        Statement::ExpressionStatement(stmt) => match &stmt.expression {
            Expression::CallExpression(call) => push_call_callback(call, out),
            // A top-level reassignment `Foo = () => …` / `Foo = function () {}`:
            // the function-like RHS is at the top level (its scope parent is the
            // program), so `findFunctionsToCompile` visits it. The binding name is
            // the assignment target identifier (`getFunctionName` for an assignment
            // RHS resolves the LHS identifier).
            Expression::AssignmentExpression(assign) => {
                let name = match &assign.left {
                    oxc::ast::ast::AssignmentTarget::AssignmentTargetIdentifier(id) => {
                        Some(id.name.as_str())
                    }
                    _ => None,
                };
                push_expression(name, &assign.right, out);
            }
            _ => {}
        },
        _ => {}
    }
}

/// The [`TargetGatingForm`] for a top-level `FunctionDeclaration` — `Path 2`
/// FunctionDeclaration→const (or `export const`), modulo the
/// referenced-before-declaration resolution applied later.
fn fn_decl_form(func: &Function<'_>, statement_span: oxc::span::Span, exported: bool) -> TargetGatingForm {
    match &func.id {
        Some(id) => TargetGatingForm::TopLevelFunctionDeclaration {
            name: id.name.as_str().to_string(),
            exported,
            statement_span: (statement_span.start, statement_span.end),
        },
        None => TargetGatingForm::ExpressionInPlace,
    }
}

fn collect_declaration<'a>(
    declaration: &'a Declaration<'a>,
    out: &mut Vec<Target<'a>>,
    statement_span: oxc::span::Span,
) {
    match declaration {
        Declaration::FunctionDeclaration(func) => {
            push_function(func, out, fn_decl_form(func, statement_span, true));
        }
        Declaration::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                push_declarator(declarator, out);
            }
        }
        _ => {}
    }
}

fn push_function<'a>(
    func: &'a Function<'a>,
    out: &mut Vec<Target<'a>>,
    gating_form: TargetGatingForm,
) {
    let Some(body) = &func.body else {
        return;
    };
    let name = func.id.as_ref().map(|id| id.name.as_str().to_string());
    out.push(Target {
        func: FunctionLike::Function(func),
        body,
        is_arrow_expression_body: false,
        binding_name: name,
        is_component_argument: false,
        is_declaration: true,
        gating_form,
    });
}

fn push_declarator<'a>(declarator: &'a VariableDeclarator<'a>, out: &mut Vec<Target<'a>>) {
    let Some(init) = &declarator.init else {
        return;
    };
    let name = declarator.id.get_identifier_name();
    push_expression(name.as_ref().map(|n| n.as_str()), init, out);
}

/// The static name of a non-computed object-property key, per `getFunctionName`'s
/// object-property branch (`Program.ts:1205-1215`, `1230`): the key is used as the
/// function name only when it `isLVal()` — i.e. a bare identifier key
/// (`{useHook: () => {}}`). A string-literal key (`{'useHook': () => {}}`) is NOT
/// an LVal in babel, so it yields no name (the function stays anonymous, classified
/// `Other` in `all` mode).
fn property_key_name(key: &oxc::ast::ast::PropertyKey<'_>) -> Option<String> {
    match key {
        oxc::ast::ast::PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
        _ => None,
    }
}

fn push_expression<'a>(name: Option<&str>, expr: &'a Expression<'a>, out: &mut Vec<Target<'a>>) {
    match expr {
        Expression::ArrowFunctionExpression(arrow) => out.push(Target {
            func: FunctionLike::Arrow(arrow),
            body: &arrow.body,
            is_arrow_expression_body: arrow.expression,
            binding_name: name.map(|n| n.to_string()),
            is_component_argument: false,
            is_declaration: false,
            gating_form: TargetGatingForm::ExpressionInPlace,
        }),
        Expression::FunctionExpression(func) => {
            if let Some(body) = &func.body {
                // `getFunctionName` prefers the function expression's own id over
                // the binding name (`const f = function g() {}` → `g`).
                let resolved_name = func
                    .id
                    .as_ref()
                    .map(|id| id.name.as_str().to_string())
                    .or_else(|| name.map(|n| n.to_string()));
                out.push(Target {
                    func: FunctionLike::Function(func),
                    body,
                    is_arrow_expression_body: false,
                    binding_name: resolved_name,
                    is_component_argument: false,
                    is_declaration: false,
                    gating_form: TargetGatingForm::ExpressionInPlace,
                });
            }
        }
        // `const View = React.memo(({items}) => ...)` / `React.memo(props => ...)`:
        // the binding name belongs to the *outer* `memo()` call, not the inner
        // callback (`getFunctionName` returns null for a function-expression whose
        // parent is a CallExpression). Discover the inner callback as a candidate
        // and mark it `is_component_argument` so `getComponentOrHookLike` can
        // classify it as a Component (Program.ts `isMemoCallback`/`isForwardRefCallback`).
        Expression::CallExpression(call) => {
            push_call_callback(call, out);
        }
        // An object literal creates no scope, so a function-like that is a property
        // value (`const _ = { useHook: () => {} }`) has the PROGRAM as its scope
        // parent — `findFunctionsToCompile`'s `all`-mode top-level guard
        // (`fn.scope.getProgramParent() !== fn.scope.parent`) does not skip it, so
        // the traversal visits it (`Program.ts:495-559`). Descend into each
        // (non-computed) property value, resolving the candidate's name from the
        // property key per `getFunctionName`'s object-property branch
        // (`Program.ts:1205-1215`: `{useHook: () => {}}` → key `useHook`).
        Expression::ObjectExpression(object) => {
            for property in &object.properties {
                if let oxc::ast::ast::ObjectPropertyKind::ObjectProperty(prop) = property {
                    // Skip object methods / getters / setters (`{subscribe() {}}`,
                    // `{get x() {}}`). Babel represents these as `ObjectMethod`,
                    // which `findFunctionsToCompile`'s
                    // `FunctionExpression`/`ArrowFunctionExpression` visitors never
                    // fire on (and `getFunctionName`'s `parent.isProperty()` is false
                    // for an `ObjectMethod`), so they are not top-level compile
                    // targets — only plain `Init` property *values* are. (oxc folds
                    // object methods into `ObjectProperty { method: true }` with a
                    // `FunctionExpression` value, which we must not descend into.)
                    if prop.computed
                        || prop.method
                        || prop.kind != oxc::ast::ast::PropertyKind::Init
                    {
                        continue;
                    }
                    let key_name = property_key_name(&prop.key);
                    push_expression(key_name.as_deref(), &prop.value, out);
                }
            }
        }
        // Likewise an array literal creates no scope, so a function-like element
        // (`const _ = [() => {}]`) is at the top level and is visited. Array
        // elements have no name (`getFunctionName` returns null).
        Expression::ArrayExpression(array) => {
            for element in &array.elements {
                if let Some(inner) = element.as_expression() {
                    push_expression(None, inner, out);
                }
            }
        }
        _ => {}
    }
}

/// Whether a call-expression callee is the React API `name` — a bare identifier
/// `name`, or a `React.name` member expression. Ports `Program.ts::isReactAPI`.
fn callee_is_react_api(callee: &Expression<'_>, name: &str) -> bool {
    match callee {
        Expression::Identifier(id) => id.name.as_str() == name,
        Expression::StaticMemberExpression(member) => {
            member.property.name.as_str() == name
                && matches!(&member.object, Expression::Identifier(obj) if obj.name.as_str() == "React")
        }
        _ => false,
    }
}

/// Discover a `React.memo(fn)` / `React.forwardRef(fn)` (or bare `memo`/
/// `forwardRef`) callback as a compilable target. The first argument, when it is
/// an (arrow) function expression, is pushed with `is_component_argument: true`
/// and **no** binding name — exactly the shape `getComponentOrHookLike`'s
/// memo/forwardRef branch handles. This mirrors `findFunctionsToCompile`'s
/// scope-based traversal, which visits these argument functions because their
/// scope parent is the program (so the `all`-mode top-level guard does not skip
/// them).
fn push_call_callback<'a>(
    call: &'a oxc::ast::ast::CallExpression<'a>,
    out: &mut Vec<Target<'a>>,
) {
    let is_memo_like =
        callee_is_react_api(&call.callee, "memo") || callee_is_react_api(&call.callee, "forwardRef");
    if !is_memo_like {
        return;
    }
    let Some(first_arg) = call.arguments.first() else {
        return;
    };
    let Some(arg_expr) = first_arg.as_expression() else {
        return;
    };
    match arg_expr {
        Expression::ArrowFunctionExpression(arrow) => out.push(Target {
            func: FunctionLike::Arrow(arrow),
            body: &arrow.body,
            is_arrow_expression_body: arrow.expression,
            binding_name: None,
            is_component_argument: true,
            is_declaration: false,
            gating_form: TargetGatingForm::ExpressionInPlace,
        }),
        Expression::FunctionExpression(func) => {
            if let Some(body) = &func.body {
                let resolved_name =
                    func.id.as_ref().map(|id| id.name.as_str().to_string());
                out.push(Target {
                    func: FunctionLike::Function(func),
                    body,
                    is_arrow_expression_body: false,
                    binding_name: resolved_name,
                    is_component_argument: true,
                    is_declaration: false,
                    gating_form: TargetGatingForm::ExpressionInPlace,
                });
            }
        }
        _ => {}
    }
}

/// The [`ReactFunctionType`] for a top-level target, ported from
/// `Entrypoint/Program.ts::getReactFunctionType` under `compilationMode: 'all'`
/// (the mode the parity oracle uses): `getComponentOrHookLike(fn) ?? 'Other'`.
///
/// A function is a `Component` only if it is component-named (capitalized),
/// calls hooks or creates JSX, has valid component params (≤2, second ref-like),
/// and does not return a non-node; a `Hook` if it is hook-named and calls hooks
/// or creates JSX. Everything else is `Other`. This matters only for
/// `InferTypes` (it gates the `props`/`ref` parameter type equations); earlier
/// stages do not print the fn type.
fn react_function_type(target: &Target<'_>) -> ReactFunctionType {
    if let Some(name) = target.binding_name.as_deref() {
        if starts_uppercase(name) {
            let is_component = calls_hooks_or_creates_jsx(target)
                && is_valid_component_params(target.func.params())
                && !returns_non_node(target);
            if is_component {
                return ReactFunctionType::Component;
            }
            return ReactFunctionType::Other;
        } else if is_hook_name(name) {
            if is_hook_name(name) && calls_hooks_or_creates_jsx(target) {
                return ReactFunctionType::Hook;
            }
            return ReactFunctionType::Other;
        }
    }

    // Otherwise, for an (arrow) function expression that is the direct callback
    // argument to `React.forwardRef()` / `React.memo()`, classify it as a
    // `Component` when it calls hooks or creates JSX (`getComponentOrHookLike`'s
    // final branch). This is the only path by which an anonymous, un-named
    // function-like becomes a Component.
    if target.is_component_argument
        && matches!(target.func, FunctionLike::Arrow(_) | FunctionLike::Function(_))
        && calls_hooks_or_creates_jsx(target)
    {
        return ReactFunctionType::Component;
    }
    ReactFunctionType::Other
}

fn starts_uppercase(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// `callsHooksOrCreatesJsx(node)`: whether the function body contains any JSX or
/// a `CallExpression` whose callee is a hook, *not* descending into nested
/// functions. (`isHook`: a hook-named identifier or a `Namespace.useFoo` member
/// where the namespace is PascalCase.)
fn calls_hooks_or_creates_jsx(target: &Target<'_>) -> bool {
    use oxc::ast::ast::{ArrowFunctionExpression, Expression, Function, JSXElement, JSXFragment};
    use oxc::ast_visit::Visit;
    use oxc::syntax::scope::ScopeFlags;

    struct Detector {
        found: bool,
    }

    fn callee_is_hook(callee: &Expression<'_>) -> bool {
        match callee {
            Expression::Identifier(ident) => is_hook_name(ident.name.as_str()),
            Expression::StaticMemberExpression(member) => {
                if !is_hook_name(member.property.name.as_str()) {
                    return false;
                }
                // The namespace object must be a PascalCase identifier.
                matches!(&member.object, Expression::Identifier(obj) if starts_uppercase(obj.name.as_str()))
            }
            _ => false,
        }
    }

    impl<'a> Visit<'a> for Detector {
        fn visit_jsx_element(&mut self, _node: &JSXElement<'a>) {
            self.found = true;
        }
        fn visit_jsx_fragment(&mut self, _node: &JSXFragment<'a>) {
            self.found = true;
        }
        fn visit_call_expression(&mut self, call: &oxc::ast::ast::CallExpression<'a>) {
            if callee_is_hook(&call.callee) {
                self.found = true;
            }
            // Still descend into arguments (they may contain JSX / hook calls at
            // this nesting level), but not into nested function bodies (those are
            // skipped via the visit_* overrides below).
            self.visit_expression(&call.callee);
            for arg in &call.arguments {
                if let Some(expr) = arg.as_expression() {
                    self.visit_expression(expr);
                }
            }
        }
        // Skip nested functions (mirrors `skipNestedFunctions`).
        fn visit_function(&mut self, _func: &Function<'a>, _flags: ScopeFlags) {}
        fn visit_arrow_function_expression(&mut self, _arrow: &ArrowFunctionExpression<'a>) {}
    }

    let mut detector = Detector { found: false };
    detector.visit_function_body(target.body);
    detector.found
}

/// `isValidPropsAnnotation(annot)`: a props parameter type annotation is invalid
/// (the function is not a component) when it is one of the primitive/structural
/// keyword/function/tuple type forms that a real props object can never be
/// (`Program.ts::isValidPropsAnnotation`, TS branch). A missing annotation, an
/// object/reference/union/etc. type, all stay valid. Only the `TSTypeAnnotation`
/// (TypeScript) branch is ported; Flow `TypeAnnotation` fixtures do not reach the
/// parity oracle through oxc's `tsx` parser.
fn is_valid_props_annotation(
    annot: Option<&oxc::ast::ast::TSTypeAnnotation<'_>>,
) -> bool {
    use oxc::ast::ast::TSType;
    let Some(annot) = annot else {
        return true;
    };
    !matches!(
        annot.type_annotation,
        TSType::TSArrayType(_)
            | TSType::TSBigIntKeyword(_)
            | TSType::TSBooleanKeyword(_)
            | TSType::TSConstructorType(_)
            | TSType::TSFunctionType(_)
            | TSType::TSLiteralType(_)
            | TSType::TSNeverKeyword(_)
            | TSType::TSNumberKeyword(_)
            | TSType::TSStringKeyword(_)
            | TSType::TSSymbolKeyword(_)
            | TSType::TSTupleType(_)
    )
}

/// `isValidComponentParams(params)`: 0 params, or ≤2 where the first is not a
/// rest element, has a valid props type annotation (`isValidPropsAnnotation`),
/// and (for two params) the second is a ref-like-named identifier.
fn is_valid_component_params(params: &oxc::ast::ast::FormalParameters<'_>) -> bool {
    let items = &params.items;
    let has_rest = params.rest.is_some();
    let count = items.len() + usize::from(has_rest);
    if count == 0 {
        return true;
    }
    if count > 2 {
        return false;
    }
    // The first param's type annotation must be a valid props annotation. oxc
    // stores a parameter's annotation on the `FormalParameter` itself.
    if let Some(first) = items.first() {
        if !is_valid_props_annotation(first.type_annotation.as_deref()) {
            return false;
        }
    }
    if count == 1 {
        // A single rest param is not valid.
        return !(has_rest && items.is_empty());
    }
    // Two params: the second must be a ref-like identifier.
    if has_rest {
        // The second "param" is the rest element — not a plain identifier.
        return false;
    }
    match items.get(1).map(|p| &p.pattern) {
        Some(oxc::ast::ast::BindingPattern::BindingIdentifier(ident)) => {
            let name = ident.name.as_str();
            name.contains("ref") || name.contains("Ref")
        }
        _ => false,
    }
}

/// `returnsNonNode(node)`: whether the function definitely returns a non-node
/// (object/arrow/function/bigint/class/new), not descending into nested
/// functions. For an arrow with an expression body the body expression is the
/// implicit return.
fn returns_non_node(target: &Target<'_>) -> bool {
    use oxc::ast::ast::{
        ArrowFunctionExpression, Expression, Function, ReturnStatement,
    };
    use oxc::ast_visit::Visit;
    use oxc::syntax::scope::ScopeFlags;

    fn is_non_node(expr: Option<&Expression<'_>>) -> bool {
        match expr {
            None => true,
            Some(expr) => matches!(
                expr,
                Expression::ObjectExpression(_)
                    | Expression::ArrowFunctionExpression(_)
                    | Expression::FunctionExpression(_)
                    | Expression::BigIntLiteral(_)
                    | Expression::ClassExpression(_)
                    | Expression::NewExpression(_)
            ),
        }
    }

    // Arrow with expression body: the body expression is the (only) return.
    if target.is_arrow_expression_body {
        if let Some(oxc::ast::ast::Statement::ExpressionStatement(stmt)) =
            target.body.statements.first()
        {
            return is_non_node(Some(&stmt.expression));
        }
    }

    struct Detector {
        non_node: bool,
    }

    impl<'a> Visit<'a> for Detector {
        fn visit_return_statement(&mut self, ret: &ReturnStatement<'a>) {
            // The TS overwrites on each return, so the last one seen wins.
            self.non_node = is_non_node(ret.argument.as_ref());
        }
        // Skip nested functions / object methods.
        fn visit_function(&mut self, _func: &Function<'a>, _flags: ScopeFlags) {}
        fn visit_arrow_function_expression(&mut self, _arrow: &ArrowFunctionExpression<'a>) {}
    }

    let mut detector = Detector { non_node: false };
    detector.visit_function_body(target.body);
    detector.non_node
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_gating_directive_matches_anchored_form() {
        // The TS regex is anchored `^use memo if\(([^\)]*)\)$`.
        assert_eq!(dynamic_gating_directive_match("use memo if(getTrue)"), Some("getTrue"));
        assert_eq!(dynamic_gating_directive_match("use memo if(true)"), Some("true"));
        // `[^\)]*` stops at the first `)`, which must be the final char.
        assert_eq!(dynamic_gating_directive_match("use memo if()"), Some(""));
        // Not anchored at the end / not the directive form.
        assert_eq!(dynamic_gating_directive_match("use memo if(getTrue) extra"), None);
        assert_eq!(dynamic_gating_directive_match("use memo"), None);
        assert_eq!(dynamic_gating_directive_match("use forget"), None);
        assert_eq!(dynamic_gating_directive_match("use memo if(getTrue"), None);
    }

    #[test]
    fn is_valid_identifier_rejects_reserved_words_and_non_idents() {
        assert!(is_valid_identifier("getTrue"));
        assert!(is_valid_identifier("_x"));
        assert!(is_valid_identifier("$x9"));
        // `t.isValidIdentifier` rejects reserved words / literals.
        assert!(!is_valid_identifier("true"));
        assert!(!is_valid_identifier("false"));
        assert!(!is_valid_identifier("null"));
        assert!(!is_valid_identifier("let"));
        // Clear non-identifiers.
        assert!(!is_valid_identifier(""));
        assert!(!is_valid_identifier("9x"));
        assert!(!is_valid_identifier("get True"));
    }

    /// `outputMode: 'lint'`: the binding-collision scope-rename side-effect
    /// (`HIRBuilder.ts:290-292`) is replayed onto the original source. An inner
    /// function parameter `ref` that shadows the outer `const ref` is renamed
    /// `ref_0` (the `_<index>` collision form from `resolveBinding`'s `#bindings`
    /// loop), and every reference to that param follows. The outer `ref` and all
    /// non-shadowing identifiers are untouched. Mirrors the
    /// `valid-setState-in-effect-from-ref-function-call` fixture oracle.
    #[test]
    fn lint_rename_propagates_shadowed_inner_param() {
        let src = "// @outputMode:\"lint\"\n\
            import {useRef} from 'react';\n\
            function Component() {\n\
            \x20\x20const ref = useRef(null);\n\
            \x20\x20function read(ref) {\n\
            \x20\x20\x20\x20return ref.current;\n\
            \x20\x20}\n\
            \x20\x20return read(ref);\n\
            }\n";
        let opts = ModuleOptions::from_source(src);
        let out = lint_rename_source(src, &opts);
        // Inner param + its body reference are renamed.
        assert!(out.contains("function read(ref_0)"), "param renamed:\n{out}");
        assert!(out.contains("return ref_0.current"), "body ref renamed:\n{out}");
        // Outer binding + its declaration + the call argument keep the bare name.
        assert!(out.contains("const ref = useRef(null)"), "outer untouched:\n{out}");
        assert!(out.contains("return read(ref);"), "outer call untouched:\n{out}");
    }

    /// A block-scoped `const data` shadowing an outer `const [data, setData]`
    /// destructured binding is renamed `data_0` along with its single reference
    /// (the `setData(data)` argument), while the outer `data`/`setData` and the
    /// final `return data` stay bare. Mirrors the
    /// `valid-setState-in-useEffect-controlled-by-ref-value` fixture oracle.
    #[test]
    fn lint_rename_propagates_shadowed_block_local() {
        let src = "// @outputMode:\"lint\"\n\
            import {useState} from 'react';\n\
            function Component() {\n\
            \x20\x20const [data, setData] = useState(null);\n\
            \x20\x20if (cond) {\n\
            \x20\x20\x20\x20const data = compute();\n\
            \x20\x20\x20\x20setData(data);\n\
            \x20\x20}\n\
            \x20\x20return data;\n\
            }\n";
        let opts = ModuleOptions::from_source(src);
        let out = lint_rename_source(src, &opts);
        assert!(out.contains("const data_0 = compute()"), "inner decl renamed:\n{out}");
        assert!(out.contains("setData(data_0)"), "inner ref renamed:\n{out}");
        assert!(out.contains("const [data, setData] = useState(null)"), "outer untouched:\n{out}");
        assert!(out.contains("return data;"), "outer return untouched:\n{out}");
    }

    /// No collision -> the source is returned byte-for-byte (the rename pass is a
    /// no-op unless a binding actually shadows an already-claimed name).
    #[test]
    fn lint_rename_is_noop_without_collision() {
        let src = "// @outputMode:\"lint\"\n\
            function Component(props) {\n\
            \x20\x20return props.x;\n\
            }\n";
        let opts = ModuleOptions::from_source(src);
        assert_eq!(lint_rename_source(src, &opts), src);
    }
}
