//! `CodegenReactiveFunction` (Stage 7): the FINAL pipeline step.
//!
//! Ports `ReactiveScopes/CodegenReactiveFunction.ts` (~2479 lines). In TS this
//! turns the post-`PruneHoistedContexts`
//! [`ReactiveFunction`](crate::reactive_scopes::ReactiveFunction) into a Babel
//! AST (`CodegenFunction`) and prints it. Here it emits the equivalent JS *source
//! text* for each compiled function, splices it over the original function-like
//! node, prepends the `react/compiler-runtime` import when any cache slots are
//! used, and the resulting program is normalized through the shared oxc
//! parser+printer ([`super::canonicalize`]) — which is exactly how the oracle
//! `result.code` is normalized on the other side of the parity comparison.
//!
//! Because verification is *canonical* (parse + reprint through the same oxc
//! `Codegen` on both sides), emitting faithful source text and routing it through
//! oxc's parser is equivalent to hand-building the oxc AST: both land on the same
//! `Program` printed by the same codegen. This keeps the port tractable across
//! the full surface (JSX preserved verbatim, every expression/terminal kind)
//! while matching the AST shape the TS compiler builds node-for-node.
//!
//! The emitted runtime (see the module docs in [`super`]):
//! - `import { c as _c } from "react/compiler-runtime";`
//! - `const $ = _c(N);` — the memo cache, sized to the slots used,
//! - per-scope change detection (`if ($[i] !== dep) { … } else { … }`),
//! - the `Symbol.for("react.memo_cache_sentinel")` form for dependency-free
//!   scopes,
//! - outlined functions appended after the component/hook.

use std::collections::{HashMap, HashSet};

use crate::compile::{
    ModuleOptions, compile_to_reactive_with_options, has_memo_cache_import,
    has_module_scope_opt_out,
};
use crate::hir::ids::DeclarationId;
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::{Identifier, IdentifierName, Place};
use crate::hir::terminal::{ReactiveScope, ReactiveScopeDependency};
use crate::hir::value::{
    ArrayElement, ArrayPattern, ArrayPatternItem, CallArgument, InstructionKind, InstructionValue,
    JsxAttribute, JsxTag, ObjectExpressionProperty, ObjectPattern, ObjectPatternProperty,
    ObjectProperty, ObjectPropertyKey, Pattern, PrimitiveValue, PropertyLiteral, PropertyType,
    SpreadPattern, TemplateQuasi,
};
use crate::reactive_scopes::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveStatement, ReactiveTerminal,
    ReactiveTerminalTargetKind, ReactiveValue,
};

/// The runtime module the memoization cache import is emitted from.
pub const RUNTIME_MODULE: &str = "react/compiler-runtime";

/// The default local name the memo-cache function (`c`) is imported under
/// (`import { c as _c } …`). `Imports.ts::addMemoCacheImport` passes `'_c'` as the
/// name hint to `newUid`, which keeps it as-is unless the program already
/// binds/references `_c`.
pub const DEFAULT_CACHE_IMPORT_NAME: &str = "_c";

/// The sentinel used for dependency-free scopes:
/// `$[i] === Symbol.for("react.memo_cache_sentinel")`.
pub const MEMO_CACHE_SENTINEL: &str = "react.memo_cache_sentinel";

/// The sentinel used for early returns inside reactive scopes.
pub const EARLY_RETURN_SENTINEL: &str = "react.early_return_sentinel";

/// Stage 7 entry point: run the full pipeline and emit the compiled JS.
///
/// This is the whole-module compile path (the Program/Entrypoint layer), so it is
/// an alias for [`compile_module`]: it finds every compilable top-level
/// function-like, honors module-scope + per-function opt-out directives, skips a
/// file that already imports the cache runtime, splices each regenerated function
/// over its original node, preserves all non-component code verbatim, and inserts
/// the runtime import once (deduped) only when something compiled used a cache
/// slot.
pub fn codegen(code: &str, filename: &str) -> String {
    compile_module(code, filename)
}

/// The Program/Entrypoint whole-module compiler — the Rust analog of
/// `Entrypoint/Program.ts::compileProgram` + the babel-plugin driver.
///
/// Ports the module-level decisions the per-function pipeline does not make:
///
/// - **`shouldSkipCompilation`** (`Program.ts`): if the file already imports `c`
///   from the React Compiler runtime module, it has already been compiled — leave
///   it entirely unchanged ([`has_memo_cache_import`]).
/// - **Module-scope opt-out** (`hasModuleScopeOptOut`): if a module-level
///   directive is `'use no forget'`/`'use no memo'`, the entire file is left
///   unchanged ([`has_module_scope_opt_out`]).
/// - **Per-function discovery + bailout**: every top-level function-like is run
///   through the pipeline; a function that fails to compile (a structured error)
///   or carries a per-function opt-out directive is left as its original source,
///   while the rest are spliced in (handled in [`compile_to_reactive`]).
/// - **Runtime import insertion**: emitted **once**, only when some compiled
///   function used a cache slot, and **deduped** — skipped if the file already
///   imports `c` from the runtime module (it cannot here, since that path is the
///   `shouldSkipCompilation` early return, but the check mirrors the TS
///   `addImportsToProgram` `hasMemoCacheFunctionImport` guard for robustness).
///
/// All non-component code (imports, exports, `FIXTURE_ENTRYPOINT`, helpers, and
/// arbitrary statements) is preserved verbatim and in order by splicing
/// right-to-left over the original byte spans.
pub fn compile_module(code: &str, filename: &str) -> String {
    // Parse the Program-level options from the fixture's first-line pragma
    // (`@compilationMode`, `@outputMode:"lint"`/`@noEmit`, `@customOptOutDirectives`),
    // mirroring the harness's `parseConfigPragmaForTests` (default
    // `compilationMode: 'all'`).
    let options = ModuleOptions::from_source(code);

    // `shouldSkipCompilation`: the file already imports the cache runtime → it has
    // already been compiled, leave it untouched.
    if has_memo_cache_import(code) {
        return code.to_string();
    }
    // `outputMode: 'lint'` / `noEmit`: run analysis but emit no compiled code —
    // the compiled function is never inserted (Program.ts `processFn` returns null
    // for every function when `outputMode === 'lint'`). The ONLY change the
    // compiler makes to the source in this mode is the binding-collision
    // scope-rename side-effect from HIR lowering (`HIRBuilder.ts:290-292`'s
    // `babelBinding.scope.rename`), which mutates the original AST that is then
    // printed. Replay that rename onto the source; absent any collision the source
    // is returned unchanged.
    if options.lint_only {
        return crate::compile::lint_rename_source(code, &options);
    }
    // Module-scope opt-out: a top-level `'use no forget'`/`'use no memo'` (or a
    // custom opt-out) directive disables compilation for the whole file
    // (Program.ts discards any compiled functions and returns without modifying
    // the program).
    if has_module_scope_opt_out(code, options.custom_opt_out_directives.as_deref()) {
        return code.to_string();
    }

    let compiled = compile_to_reactive_with_options(code, filename, &options);

    // The memo-cache function is imported under a single shared local name per
    // module (`ProgramContext::addMemoCacheImport` → `newUid('_c')`), which is
    // `_c` unless the program already binds/references it (then `_c2`/`_c3`/…).
    // Compute it once over the ORIGINAL source's identifiers and thread it into
    // every emitter so the `const $ = <name>(N)` preface and the import agree.
    let cache_import_name = memo_cache_import_name(code);

    // `enableNameAnonymousFunctions` (default off): codegen consults this flag to
    // decide whether an anonymous `FunctionExpression` with a `nameHint` is
    // wrapped in the `{ "<hint>": <fn> }["<hint>"]` naming form. Read once from
    // the module pragmas (the same source the pipeline's gated pass uses).
    let env_config = crate::environment::EnvironmentConfig::from_source(code);
    let enable_name_anonymous_functions = env_config.enable_name_anonymous_functions;

    // `enableResetCacheOnSourceFileChanges` (`CodegenReactiveFunction.ts:133-146`):
    // when the pragma is set AND the source code is known (`fn.env.code !== null`,
    // always the case here — `code` IS the module source), precompute the source
    // hash once. Node uses `createHmac('sha256', fn.env.code).digest('hex')`, i.e.
    // `HMAC-SHA256(key = source, message = "")`, hex-encoded. Threaded into each
    // top-level emitter, which reserves slot 0 for it and emits the reset guard.
    let fast_refresh_hash = if env_config.enable_reset_cache_on_source_file_changes {
        Some(super::hash::hmac_sha256_hex(code.as_bytes(), b""))
    } else {
        None
    };

    // `enableEmitInstrumentForget` (`CodegenReactiveFunction.ts:247-307`): when set,
    // resolve the import-local names ONCE (`addImportSpecifier` -> `newUid` against
    // the program-wide identifier set ∪ the `_c` cache name) and build the shared
    // `if`-test. The gating import is added before the instrumentation function in
    // the TS (the `gating` lookup at line 258 precedes the `fn` lookup at line 297),
    // so `newUid` resolves the gating name first. The result is threaded into each
    // top-level emitter and the resolved imports are emitted once at the end.
    let instrument_forget = env_config
        .enable_emit_instrument_forget
        .as_ref()
        .map(|cfg| resolve_instrument_forget(cfg, code, filename, &cache_import_name));
    let instrument_forget_resolved = instrument_forget.as_ref().map(|(r, _)| r.clone());

    // `enableEmitHookGuards` (`CodegenReactiveFunction.ts:150-159, 1392-1424`):
    // resolve the `$dispatcherGuard` import-local name once (`newUid` against the
    // program-wide identifier set ∪ `_c`) and build its import line. Threaded into
    // each top-level emitter; the body try/finally guard and the per-hook-call IIFE
    // both reference this name.
    let hook_guard: Option<(String, String)> =
        env_config.enable_emit_hook_guards.as_ref().map(|cfg| {
            let mut taken = collect_program_names(code);
            taken.insert(cache_import_name.clone());
            let local = crate::gating::new_uid(&cfg.import_specifier_name, &taken);
            let import_line = if local == cfg.import_specifier_name {
                format!("import {{ {} }} from \"{}\";", cfg.import_specifier_name, cfg.source)
            } else {
                format!(
                    "import {{ {} as {} }} from \"{}\";",
                    cfg.import_specifier_name, local, cfg.source
                )
            };
            (local, import_line)
        });
    let hook_guard_local = hook_guard.as_ref().map(|(l, _)| l.clone());

    // Splice each regenerated function over its original span (right-to-left so
    // earlier spans stay valid), preserving every surrounding statement verbatim.
    // A function with no `reactive` (a structured error or a per-function opt-out)
    // is left as its original source — the per-function graceful bailout.
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let mut any_cache = false;
    // Outlined functions are inserted as true module-level siblings, per
    // `Program.ts::insertNewOutlinedFunctionNode`:
    //   * for a `FunctionDeclaration` original, `originalFn.insertAfter(fn)` —
    //     right after the function (so before the subsequent statements). We model
    //     this by appending the outlined text into the original function's splice
    //     replacement.
    //   * for an (Arrow)FunctionExpression original (`const C = …`,
    //     `React.memo(…)`), `program.pushContainer('body', [fn])` — appended to the
    //     END of the program body. Collected here and appended after all splices.
    let mut module_end_outlined: Vec<String> = Vec::new();
    // `@gating`/dynamic-gating: when active, each compiled function is wrapped in a
    // runtime gating selector (`Entrypoint/Gating.ts`). The gating import-local name
    // is resolved once via `newUid` against the program-wide identifier set (plus
    // the `_c` cache name) — `Imports.ts::addImportSpecifier`.
    let mut gating_state: Option<crate::gating::GatingState> = None;
    let mut taken_names: Option<HashSet<String>> = None;
    let mut gating_applied = false;
    // Whether any compiled function actually received an instrument-forget call (a
    // *named* function — `fn.id != null`). The `react-compiler-runtime` import is
    // emitted only if so, mirroring `addImportSpecifier` being called inside the
    // codegen loop only for named functions.
    let mut instrument_forget_applied = false;
    // Whether any compiled function received a hook guard (the body try/finally is
    // emitted for every compiled function in client mode, so the `$dispatcherGuard`
    // import is added whenever at least one function compiled).
    let mut hook_guard_applied = false;
    for target in &compiled {
        let Some(reactive) = &target.reactive else {
            continue;
        };
        let mut emitter = Emitter::with_cache_import_name(
            target.unique_identifiers.clone(),
            cache_import_name.clone(),
            target.fbt_operands.iter().map(|id| id.as_u32()).collect(),
            enable_name_anonymous_functions,
        );
        // Instrument-forget is emitted only for named functions, exactly as the TS
        // `fn.id != null` guard (`CodegenReactiveFunction.ts:250`).
        if reactive.id.is_some() {
            emitter.instrument_forget = instrument_forget_resolved.clone();
            if emitter.instrument_forget.is_some() {
                instrument_forget_applied = true;
            }
        }
        // Hook guards wrap every compiled function body (no id requirement), so set
        // it unconditionally when the pragma is on.
        emitter.hook_guard = hook_guard_local.clone();
        if emitter.hook_guard.is_some() {
            hook_guard_applied = true;
        }
        // Fast-refresh: every top-level `codegenFunction` allocates the hash slot
        // (no id requirement); the reset guard is only *emitted* if the function
        // ends up using the cache, which the reserved slot guarantees.
        emitter.fast_refresh_hash = fast_refresh_hash.clone();
        let mut body = emitter.codegen_function(reactive, target.is_arrow);
        // Render the outlined declarations in source order first.
        let decls: Vec<String> = target
            .outlined
            .iter()
            .map(|o| emitter.codegen_outlined(o))
            .collect();
        if emitter.cache_count > 0 {
            any_cache = true;
        }

        // Gating wrapper (`applyCompiledFunctions`'s `functionGating != null`
        // branch): replace the plain function-over-span splice with the gating
        // selector (in-place conditional, const conversion, export-default pair, or
        // the hoistable Path 1 form). Outlined functions for a gated function are
        // appended after the gating edit, exactly as for a non-gated one.
        if let Some(info) = &target.gating {
            let taken = taken_names.get_or_insert_with(|| {
                let mut set = collect_program_names(code);
                set.insert(cache_import_name.clone());
                set
            });
            let state = gating_state
                .get_or_insert_with(|| crate::gating::GatingState::new(info.function.clone(), taken));
            let edit = crate::gating::build_gating_edit(
                info,
                state,
                &body,
                target.span,
                taken,
            );
            let mut text = edit.text;
            // Outlined siblings follow the gated statement in the same insertion
            // order as the non-gated path.
            if target.is_declaration {
                for decl in decls.iter().rev() {
                    text.push('\n');
                    text.push_str(decl);
                }
            } else {
                module_end_outlined.extend(decls);
            }
            gating_applied = true;
            edits.push((edit.span.0 as usize, edit.span.1 as usize, text));
            continue;
        }

        if target.is_declaration {
            // `originalFn.insertAfter(fn)`: each outlined fn is inserted directly
            // after the original declaration, so repeated insertions push the
            // earlier ones further down — the emitted order is the REVERSE of the
            // outlining order (the last-outlined sits closest to the function).
            for decl in decls.iter().rev() {
                body.push('\n');
                body.push_str(decl);
            }
        } else {
            // `program.pushContainer('body', [fn])`: appended to the END of the
            // module in outlining order.
            module_end_outlined.extend(decls);
        }
        edits.push((target.span.0 as usize, target.span.1 as usize, body));
    }

    // When `@gating` is active, the gating import is `unshiftContainer`'d to the
    // front of the program, so babel re-attaches the file's leading pragma comment
    // (`// @gating …`) as a TRAILING comment on the new gating import line — which
    // oxc's codegen (and the oracle's canonical form) then drops. The Rust splice
    // preserves the leading comment in place, where it re-attaches to the next
    // surviving statement as a LEADING comment (which oxc keeps), so it would
    // spuriously survive. Drop that single leading first-line pragma comment so both
    // sides agree. (Interior/docblock comments — e.g. `reassigned-fnexpr-variable`'s
    // `/** … */` — are untouched; the oracle keeps those.)
    //
    // The same re-attachment happens for the `enableEmitInstrumentForget`
    // `react-compiler-runtime` import (also `unshiftContainer`'d): the leading
    // `// @enableEmitInstrumentForget …` pragma becomes a trailing comment on the
    // top import, which oxc drops. Drop it on the Rust side too when either path
    // prepended an import.
    if gating_applied || instrument_forget_applied || hook_guard_applied {
        if let Some((start, end)) = leading_pragma_comment_span(code) {
            edits.push((start, end, String::new()));
        }
    }

    let mut out = code.to_string();
    edits.sort_by(|a, b| b.0.cmp(&a.0));
    for (start, end, text) in edits {
        if start <= end && end <= out.len() {
            out.replace_range(start..end, &text);
        }
    }

    // Append the (Arrow)FunctionExpression-sourced outlined functions at the end
    // of the module (after all original statements), each on its own line —
    // matching `pushContainer('body', ...)`.
    for decl in module_end_outlined {
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&decl);
        out.push('\n');
    }

    // `@flow`-first-line files are parsed comment-free, so strip ALL comments from
    // the output. The harness (`__tests__/runner/harness.ts:65,152`) selects the
    // parser from the FIRST LINE only — `parseLanguage(firstLine)` is `'flow'` iff
    // `firstLine.indexOf('@flow') !== -1` — and the flow path uses HermesParser,
    // which does NOT retain comments (`HermesParser.parse(input, {babel: true,
    // flow: 'all', …})`). Because the React Compiler only rewrites the compiled
    // functions and reprints the rest of that already-comment-free AST, the whole
    // emitted module has no comments. So when the first line declares `@flow`, drop
    // every comment (this subsumes the old leading-pragma-only strip — the `// @flow
    // …` docblock and any later `/** … */` go together). A `@flow` appearing only
    // *after* the first line (e.g. `reassign-in-while-loop-condition`, where the
    // file's first line is an `import`) routes through the babel/typescript parser,
    // which preserves comments — so that case is left untouched.
    out = strip_comments_if_flow_first_line(code, &out);

    // `@gating`: prepend the gating-function import (`addImportSpecifier` →
    // `addImportsToProgram`'s `unshiftContainer`). The compiler-added imports are
    // module-sorted (`localeCompare`) before being unshifted, so the
    // `react/compiler-runtime` cache import lands first and the gating import
    // second; we prepend the gating import here, then `add_runtime_import` prepends
    // `_c` on top, yielding that order. The import is emitted whenever any function
    // was gated (regardless of cache use), matching the TS — the gating import is
    // added per gated function and is never removed (only `_c` is removed when no
    // applied function used memoization).
    if gating_applied {
        if let Some(state) = &gating_state {
            out = format!("{}\n{}", state.import_line(), out);
        }
    }

    // Insert the runtime import once, only when a compiled function used a cache
    // slot, and only if the file does not already import it (deduped). The
    // already-imports case is handled by the `shouldSkipCompilation` early return
    // above; this guard keeps the invariant explicit and robust.
    if any_cache && !has_memo_cache_import(&out) {
        out = add_runtime_import(&out, &cache_import_name, options.script_source_type);
    }

    // `enableEmitInstrumentForget` / `enableEmitHookGuards`: prepend the
    // `react-compiler-runtime` import last (it sorts FIRST by module `localeCompare`:
    // `react-compiler-runtime` < `react/compiler-runtime`), so it lands on top of the
    // `_c` and gating imports — matching `addImportsToProgram`'s sorted unshift. Only
    // one of these features is active per fixture (no corpus fixture combines them),
    // so the single prepend is unambiguous.
    if instrument_forget_applied {
        if let Some((_, import_line)) = &instrument_forget {
            out = format!("{import_line}\n{out}");
        }
    }
    if hook_guard_applied {
        if let Some((_, import_line)) = &hook_guard {
            out = format!("{import_line}\n{out}");
        }
    }
    out
}

/// Strip ALL comments from `out` when the ORIGINAL source's first line declares
/// `@flow`, mirroring the harness's parser selection.
///
/// The harness (`__tests__/runner/harness.ts`) reads only the first line to pick
/// the parser — `parseLanguage(firstLine)` returns `'flow'` iff
/// `firstLine.indexOf('@flow') !== -1` (line 65–66, called with `firstLine` at
/// line 152) — and the flow path parses with `HermesParser.parse(input, {babel:
/// true, flow: 'all', …})` (line 111–118). HermesParser does not retain comments,
/// so the resulting babel AST is comment-free; the React Compiler only rewrites
/// the compiled functions and reprints the rest of that AST, so the entire emitted
/// module has no comments (verified: every first-line-`@flow` corpus oracle has
/// zero comment lines, while a `@flow` appearing only later in the file —
/// `reassign-in-while-loop-condition`, whose first line is an `import` — routes
/// through the babel/typescript parser and keeps its comments).
///
/// Stripping is done on the parsed AST (clearing `program.comments`) rather than
/// by string surgery so it covers every comment uniformly (the docblock pragma
/// `// @flow …`, interior `/** … */` blocks, and `// …` line comments) exactly as
/// a comment-free parse would. This subsumes the previous leading-pragma-only
/// strip. The reprint is faithful under the canonical comparison (both sides
/// re-parse + reprint through the same oxc codegen).
fn strip_comments_if_flow_first_line(original: &str, out: &str) -> String {
    use oxc::allocator::Allocator;
    use oxc::codegen::Codegen;
    use oxc::parser::Parser;
    use oxc::span::SourceType;

    let first_line = original.split('\n').next().unwrap_or("");
    if !first_line.contains("@flow") {
        return out.to_string();
    }
    let allocator = Allocator::default();
    let mut parsed = Parser::new(&allocator, out, SourceType::tsx()).parse();
    if !parsed.errors.is_empty() {
        // If the emitted output does not re-parse cleanly, leave it untouched
        // rather than risk corrupting it (the canonical comparison will still
        // route it through oxc on both sides).
        return out.to_string();
    }
    parsed.program.comments.clear();
    Codegen::new()
        .with_source_text(parsed.program.source_text)
        .build(&parsed.program)
        .code
}

/// Insert the `c as _c` import from the runtime module into `code`, porting
/// `Imports.ts::addImportsToProgram`:
///
/// - If the program already has a **non-namespaced named** import declaration
///   from the runtime module (`import { ... } from "react/compiler-runtime"`,
///   *not* `import * as` and *not* `import type`/`typeof`), splice `, c as _c`
///   into that declaration's specifier list (`pushContainer('specifiers', …)`
///   appends after the existing specifiers).
/// - Otherwise, unshift a fresh `import { c as _c } from "…";` onto the program.
///
/// The merge is done as a byte-level edit at the last existing specifier's span
/// end, which is faithful under the canonical comparison (re-parsed + reprinted
/// on both sides).
/// Compute the local name the memo-cache function is imported under, porting
/// `ProgramContext::addMemoCacheImport` → `newUid('_c')` (`Imports.ts:117-152`).
///
/// `newUid('_c')` keeps `_c` when the program neither binds nor references it
/// (`_c` is not a hook name, so the `else if (!hasReference(name))` branch
/// returns it directly). Otherwise it calls Babel's `scope.generateUid('_c')`,
/// which strips leading underscores and trailing digits (`'_c' → 'c'`) then tries
/// `_c`, `_c2`, `_c3`, … until one is free of any binding/reference/global.
///
/// `hasReference` is program-wide (`knownReferencedNames | scope.hasBinding |
/// scope.hasGlobal | scope.hasReference`), so we conservatively treat *every*
/// identifier name that appears anywhere in the original source — declared
/// bindings and referenced identifiers alike — as taken.
/// Collect every identifier name that appears anywhere in `code` — declared
/// bindings, referenced identifiers, and JSX names alike. This is the conservative
/// program-wide `hasReference` analog (`Imports.ts::hasReference` =
/// `knownReferencedNames | scope.hasBinding | scope.hasGlobal | scope.hasReference`)
/// used by `newUid` to allocate collision-free import-local names.
pub(crate) fn collect_program_names(code: &str) -> HashSet<String> {
    use oxc::allocator::Allocator;
    use oxc::ast::ast::IdentifierReference;
    use oxc::ast::ast::{BindingIdentifier, JSXIdentifier};
    use oxc::ast_visit::{Visit, walk};
    use oxc::parser::Parser;
    use oxc::span::SourceType;

    struct NameCollector {
        names: HashSet<String>,
    }
    impl<'a> Visit<'a> for NameCollector {
        fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
            self.names.insert(it.name.to_string());
        }
        fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
            self.names.insert(it.name.to_string());
            walk::walk_identifier_reference(self, it);
        }
        fn visit_jsx_identifier(&mut self, it: &JSXIdentifier<'a>) {
            // JSX element/attribute names reference globals/locals too.
            self.names.insert(it.name.to_string());
        }
    }

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::tsx()).parse();
    let mut collector = NameCollector {
        names: HashSet::new(),
    };
    collector.visit_program(&parsed.program);
    collector.names
}

/// The byte span `[start, end)` of the file's leading line/block comment, when
/// the source begins (after optional leading whitespace) with `//` or `/* … */`.
/// Includes the comment and a single following newline so removing it leaves no
/// blank line. Returns `None` if the file does not start with a comment.
fn leading_pragma_comment_span(code: &str) -> Option<(usize, usize)> {
    let bytes = code.as_bytes();
    // Skip leading whitespace (the comment removal includes it so no blank prefix
    // remains).
    let mut start = 0usize;
    while start < bytes.len() && (bytes[start] == b' ' || bytes[start] == b'\t') {
        start += 1;
    }
    if code[start..].starts_with("//") {
        // Line comment: runs to the next newline (inclusive).
        let nl = code[start..].find('\n').map(|i| start + i + 1).unwrap_or(code.len());
        Some((start, nl))
    } else if code[start..].starts_with("/*") {
        // Block comment: runs to the closing `*/` (+ a trailing newline if present).
        let close = code[start + 2..].find("*/").map(|i| start + 2 + i + 2)?;
        let end = if code[close..].starts_with('\n') {
            close + 1
        } else {
            close
        };
        Some((start, end))
    } else {
        None
    }
}

/// Resolve the `enableEmitInstrumentForget` config into the per-function injection
/// data + the `react-compiler-runtime` import line, porting
/// `CodegenReactiveFunction.ts:247-307` + `Imports.ts::addImportSpecifier`/
/// `addImportsToProgram`.
///
/// - Import-local names are `newUid`-resolved against the program-wide identifier
///   set (∪ the `_c` cache name). The gating specifier is added before the
///   instrumentation function (matching the TS lookup order at lines 258 / 297), so
///   it claims its uid first.
/// - The `if`-test combines `<globalGating> && <gating>` when both are present, or
///   the single present gate otherwise (`globalGating` is a bare identifier — the TS
///   only asserts the global binding exists, it is NOT imported).
/// - The module import groups both specifiers under `react-compiler-runtime`, sorted
///   by `imported` name `localeCompare` (`shouldInstrument` < `useRenderCounter`).
/// - The virtual filepath mirrors the harness's `'/' + basename + ('.ts' unless
///   @flow)` (`__tests__/runner/harness.ts:152-156`); `basename` is `filename` with
///   its source extension stripped.
fn resolve_instrument_forget(
    cfg: &crate::environment::InstrumentationConfig,
    code: &str,
    filename: &str,
    cache_import_name: &str,
) -> (ResolvedInstrumentForget, String) {
    let mut taken = collect_program_names(code);
    taken.insert(cache_import_name.to_string());

    // Gating import (resolved first), then the global gate (a bare identifier — not
    // imported), then the instrumentation function.
    let gating_local = cfg.gating.as_ref().map(|gating| {
        let local = crate::gating::new_uid(&gating.import_specifier_name, &taken);
        taken.insert(local.clone());
        (gating.import_specifier_name.clone(), local)
    });
    let global_gating = cfg.global_gating.clone();
    let fn_local = crate::gating::new_uid(&cfg.fn_spec.import_specifier_name, &taken);
    taken.insert(fn_local.clone());

    // Build the `if`-test: `<globalGating> && <gating>` | `<gating>` | `<globalGating>`.
    let gating_test = gating_local.as_ref().map(|(_, local)| local.clone());
    let if_test = match (&global_gating, &gating_test) {
        (Some(g), Some(s)) => format!("{g} && {s}"),
        (None, Some(s)) => s.clone(),
        (Some(g), None) => g.clone(),
        // The `InstrumentationSchema` `refine` requires at least one gate; the test
        // default always supplies both. Fall back to a bare `true` to stay total.
        (None, None) => "true".to_string(),
    };

    // The `react-compiler-runtime` import: both specifiers sorted by imported name.
    let mut specifiers: Vec<(String, String)> = Vec::new();
    if let Some((imported, local)) = &gating_local {
        specifiers.push((imported.clone(), local.clone()));
    }
    specifiers.push((cfg.fn_spec.import_specifier_name.clone(), fn_local.clone()));
    specifiers.sort_by(|a, b| a.0.cmp(&b.0));
    let specifier_text = specifiers
        .iter()
        .map(|(imported, local)| {
            if imported == local {
                imported.clone()
            } else {
                format!("{imported} as {local}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let import_line = format!("import {{ {specifier_text} }} from \"{}\";", cfg.fn_spec.source);

    let resolved = ResolvedInstrumentForget {
        instrument_fn_local: fn_local,
        if_test,
        virtual_filepath: virtual_filepath(code, filename),
    };
    (resolved, import_line)
}

/// The harness's virtual filepath for a fixture: `'/' + basename + ('.ts' unless the
/// first line declares `@flow`)` (`__tests__/runner/harness.ts:152-156`).
///
/// In the TS, `basename` is `path.basename(key)` — the LAST path segment of the
/// fixture's file path (`runner-worker.ts`). The corpus harness flattens a
/// subdirectory-nested fixture's path into a sanitized name by replacing `/` with
/// `__` (`examples/seed_corpus.rs`), so we recover the original basename by taking
/// the segment after the last `__`, then strip the trailing source extension.
fn virtual_filepath(code: &str, filename: &str) -> String {
    // Strip the last extension (the corpus harness passes `<name>.<srcext>`).
    let stem = match filename.rfind('.') {
        Some(idx) => &filename[..idx],
        None => filename,
    };
    // Recover `path.basename`: the last `/`-segment, which the corpus flattens to
    // the segment after the last `__`.
    let basename = stem.rsplit("__").next().unwrap_or(stem);
    let first_line = code.split('\n').next().unwrap_or("");
    let is_flow = first_line.contains("@flow");
    if is_flow {
        format!("/{basename}")
    } else {
        format!("/{basename}.ts")
    }
}

fn memo_cache_import_name(code: &str) -> String {
    let taken = collect_program_names(code);

    // `newUid('_c')`: `_c` is not a hook name, so return it unchanged if free.
    if !taken.contains(DEFAULT_CACHE_IMPORT_NAME) {
        return DEFAULT_CACHE_IMPORT_NAME.to_string();
    }
    // `scope.generateUid('_c')`: base `'c'`, candidates `_c`, `_c2`, `_c3`, …
    let mut counter = 2u32;
    loop {
        let candidate = format!("_c{counter}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn add_runtime_import(code: &str, cache_import_name: &str, script_source_type: bool) -> String {
    use oxc::allocator::Allocator;
    use oxc::ast::ast::{ImportDeclarationSpecifier, ImportOrExportKind, Statement};
    use oxc::parser::Parser;
    use oxc::span::{GetSpan, SourceType};

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::tsx()).parse();

    // Insertion point for a freshly-added import: AFTER any leading directive
    // prologue (`"use client"`, `"use strict"`, …). Directives live outside the
    // statement `body` (like babel's `Program.directives`), and the TS inserts the
    // runtime import via `unshiftContainer('body', …)` (Imports.ts:316), which lands
    // after them — so the directive stays first and keeps its meaning. Prepending at
    // byte 0 would demote `"use client"` to a non-directive expression statement.
    let insert_at: usize = if parsed.program.directives.is_empty() {
        0
    } else {
        parsed
            .program
            .body
            .first()
            .map(|s| s.span().start as usize)
            .unwrap_or_else(|| parsed.program.directives.last().unwrap().span().end as usize)
    };
    let splice = |insertion: &str| -> String {
        let mut out = String::with_capacity(code.len() + insertion.len());
        out.push_str(&code[..insert_at]);
        out.push_str(insertion);
        out.push_str(&code[insert_at..]);
        out
    };

    // Script source type (`@script`): there are no ESM `import` declarations to
    // merge into, so `addImportsToProgram` emits the `require(…)` destructure form
    // (`Imports.ts:295-313`).
    if script_source_type {
        return splice(&format!(
            "const {{ c: {cache_import_name} }} = require(\"{RUNTIME_MODULE}\");\n"
        ));
    }

    for stmt in &parsed.program.body {
        let Statement::ImportDeclaration(import) = stmt else {
            continue;
        };
        if import.source.value.as_str() != RUNTIME_MODULE {
            continue;
        }
        // `isNonNamespacedImport`: every specifier is an `ImportSpecifier` and the
        // declaration is not `import type`/`import typeof`.
        if import.import_kind != ImportOrExportKind::Value {
            continue;
        }
        let Some(specifiers) = &import.specifiers else {
            continue;
        };
        let all_named = specifiers
            .iter()
            .all(|s| matches!(s, ImportDeclarationSpecifier::ImportSpecifier(_)));
        if !all_named {
            continue;
        }
        // Append `, c as _c` after the last existing specifier (matching
        // `pushContainer('specifiers', …)`, which keeps the existing specifiers
        // first). For an empty `import {} from "…"`, insert without a leading
        // comma.
        let Some(last) = specifiers.last() else {
            // `import {} from "react/compiler-runtime";` — insert into the braces.
            // The `{}` follows `import `; find the `{` after the import keyword and
            // place `c as _c` inside. Fall back to a prepended fresh import if the
            // structure is unexpected.
            break;
        };
        let insert_at = last.span().end as usize;
        if insert_at <= code.len() {
            let mut out = String::with_capacity(code.len() + 16);
            out.push_str(&code[..insert_at]);
            out.push_str(&format!(", c as {cache_import_name}"));
            out.push_str(&code[insert_at..]);
            return out;
        }
    }
    // No mergeable existing import: insert a fresh one after any leading directives.
    splice(&format!(
        "import {{ c as {cache_import_name} }} from \"{RUNTIME_MODULE}\";\n"
    ))
}

/// What a temporary's [`DeclarationId`] resolves to in `cx.temp`: a pre-rendered
/// JS expression (e.g. `props.handler`), a JSX text node, or `None` (declared but
/// not yet assigned — a parameter or a destructured binding).
#[derive(Clone)]
enum Temp {
    Expr(String),
    JsxText(String),
    /// A member access `object.prop` / `object[prop]`, kept split so an
    /// enclosing `OptionalExpression` can rebuild it as `object?.prop` /
    /// `object?.[prop]` (the TS rebuilds `t.optionalMemberExpression` from the
    /// resolved member's `.object`/`.property`/`.computed`).
    Member {
        object: String,
        property: String,
        computed: bool,
    },
    /// A call `callee(args)` / `callee[m](args)`, kept split so an enclosing
    /// `OptionalExpression` can rebuild it as `callee?.(args)`.
    Call { callee: String, args: String },
    /// A fully-rendered optional-chain expression (`a?.b`, `a?.b.c`, `a?.()`).
    /// Tracked distinctly so a *non-optional* member/call applied to it at the top
    /// level (outside any enclosing optional chain) parenthesizes it — babel-
    /// generator wraps an `OptionalMemberExpression`/`OptionalCallExpression` that is
    /// the object of a plain `MemberExpression`, since `(a?.b).c` (chain terminated,
    /// `.c` unconditional) differs from `a?.b.c` (chain continues). The
    /// `OptionalExpression` rebuild itself extends the chain without wrapping.
    OptionalChain(String),
}

/// The resolved-once `enableEmitInstrumentForget` data threaded into each
/// [`Emitter`] (`CodegenReactiveFunction.ts:247-307`). The import-local names are
/// `newUid`-resolved against the program-wide identifier set, the `if_test` is the
/// `<globalGating> && <gating>` test built from whichever gates are present, and
/// `virtual_filepath` is the harness's `'/' + basename + '.ts'` filename used as
/// the second call argument.
#[derive(Clone)]
struct ResolvedInstrumentForget {
    /// The instrumentation function's import-local name (e.g. `useRenderCounter`).
    instrument_fn_local: String,
    /// The fully-built `if` test expression text (e.g. `DEV && shouldInstrument`).
    if_test: String,
    /// The virtual file path used as the second call argument (e.g.
    /// `/codegen-instrument-forget-test.ts`).
    virtual_filepath: String,
}

/// The codegen context (`Context` in the TS): cache-slot allocation, the
/// temporary map, declared-binding set, synthesized names, and the
/// `uniqueIdentifiers` set used to keep `$`/`$i` collision-free.
struct Emitter {
    cache_count: u32,
    temp: HashMap<DeclarationId, Option<Temp>>,
    declarations: HashSet<DeclarationId>,
    unique_identifiers: HashSet<String>,
    synthesized_names: HashMap<String, String>,
    /// The local name the memo-cache runtime is imported under (`c as <name>`),
    /// used for the `const $ = <name>(N);` preface. Defaults to `_c`, but
    /// `addMemoCacheImport`/`newUid('_c')` picks a fresh `_c2`/`_c3`/… when the
    /// program already binds or references `_c` (`Imports.ts:144-152,117-142`).
    cache_import_name: String,
    /// `ObjectMethod` instructions keyed by their lvalue identifier id, recorded
    /// so an object-expression `method` property can emit them.
    object_methods: HashMap<u32, InstructionValue>,
    /// Nesting depth inside an `OptionalExpression` rebuild. `> 0` means the member/
    /// call currently being codegen'd is part of an optional chain (so a member on an
    /// optional-chain object extends the chain and must NOT be parenthesized);
    /// `== 0` means a top-level access, where a plain member on an optional-chain
    /// object terminates the chain and must be wrapped (see [`Temp::OptionalChain`]).
    optional_depth: usize,
    /// `cx.fbtOperands`: the macro-operand identifier ids from
    /// `MemoizeFbtAndMacroOperandsInSameScope`. A string-literal JSX attribute whose
    /// place is in this set is emitted *bare* even when it would otherwise require an
    /// expression container, matching the TS `!cx.fbtOperands.has(...)` guard.
    fbt_operands: HashSet<u32>,
    /// `cx.env.config.enableNameAnonymousFunctions`: when set, an anonymous
    /// `FunctionExpression` carrying a `nameHint` is wrapped in
    /// `{ "<hint>": <fn> }["<hint>"]` so the engine infers a descriptive `.name`
    /// (`codegenInstructionValue` `FunctionExpression` case).
    enable_name_anonymous_functions: bool,
    /// `cx.env.config.enableEmitInstrumentForget`: when set (and the function has an
    /// id), [`Self::codegen_function`] unshifts an `if (<gates>) <fn>("<id>",
    /// "<filepath>");` instrumentation call onto the body. `None` for outlined
    /// functions and when the pragma is off.
    instrument_forget: Option<ResolvedInstrumentForget>,
    /// `cx.env.config.enableEmitHookGuards`: the `$dispatcherGuard` import-local
    /// name. When `Some`, each hook *call* is wrapped in a `(function () { try {
    /// <fn>(2); return <call>; } finally { <fn>(3); } })()` IIFE
    /// (`createCallExpression`) and the whole function body is wrapped in a
    /// `try { <fn>(0); … } finally { <fn>(1); }` guard (`createHookGuard`). `None`
    /// for outlined functions and when the pragma is off.
    hook_guard: Option<String>,
    /// `cx.env.config.enableResetCacheOnSourceFileChanges` + `fn.env.code`: the
    /// precomputed `HMAC-SHA256(source).digest('hex')` source hash. When `Some`,
    /// [`Self::codegen_function`] reserves cache slot 0 for the hash (BEFORE
    /// emitting any scope, exactly like the TS `cacheIndex = cx.nextCacheIndex`
    /// read at `CodegenReactiveFunction.ts:143`) and — if the function uses the
    /// cache at all — emits the fast-refresh reset guard that wipes every slot to
    /// the memo sentinel when the stored hash differs. `None` for outlined
    /// functions and when the pragma is off (`CodegenReactiveFunction.ts:127-243`).
    fast_refresh_hash: Option<String>,
}

impl Emitter {
    fn with_cache_import_name(
        unique_identifiers: HashSet<String>,
        cache_import_name: String,
        fbt_operands: HashSet<u32>,
        enable_name_anonymous_functions: bool,
    ) -> Self {
        Emitter {
            cache_count: 0,
            temp: HashMap::new(),
            declarations: HashSet::new(),
            unique_identifiers,
            synthesized_names: HashMap::new(),
            cache_import_name,
            object_methods: HashMap::new(),
            optional_depth: 0,
            fbt_operands,
            enable_name_anonymous_functions,
            instrument_forget: None,
            hook_guard: None,
            fast_refresh_hash: None,
        }
    }

    fn next_cache_index(&mut self) -> u32 {
        let index = self.cache_count;
        self.cache_count += 1;
        index
    }

    fn declare(&mut self, id: &Identifier) {
        self.declarations.insert(id.declaration_id);
    }

    fn has_declared(&self, id: &Identifier) -> bool {
        self.declarations.contains(&id.declaration_id)
    }

    /// `synthesizeName(name)`: a collision-free name (`$`, then `$0`, `$1`, …).
    fn synthesize_name(&mut self, name: &str) -> String {
        if let Some(prev) = self.synthesized_names.get(name) {
            return prev.clone();
        }
        let mut validated = name.to_string();
        let mut index = 0u32;
        while self.unique_identifiers.contains(&validated) {
            validated = format!("{name}{index}");
            index += 1;
        }
        self.unique_identifiers.insert(validated.clone());
        self.synthesized_names.insert(name.to_string(), validated.clone());
        validated
    }

    fn cache(&mut self) -> String {
        self.synthesize_name("$")
    }

    /// `createCallExpression` (`CodegenReactiveFunction.ts:1392-1424`): when
    /// `enableEmitHookGuards` is set and the callee resolves to a hook
    /// (`getHookKind(...) != null`), wrap the call in a guard IIFE rather than
    /// emitting it bare:
    /// `(function () { try { <fn>(2); return <callee>(<args>); } finally { <fn>(3); } })()`.
    /// Returns `None` when guards are off or the callee is not a hook.
    fn maybe_hook_guard_iife(
        &self,
        callee_id: &Identifier,
        callee_str: &str,
        args_str: &str,
    ) -> Option<String> {
        let guard_fn = self.hook_guard.as_ref()?;
        if crate::passes::infer_reactive_places::get_hook_kind(callee_id).is_none() {
            return None;
        }
        Some(format!(
            "(function () {{\ntry {{\n{guard_fn}(2);\nreturn {callee_str}({args_str});\n}} finally {{\n{guard_fn}(3);\n}}\n}})()"
        ))
    }

    // --- function shell ----------------------------------------------------

    /// `codegenFunction` + preamble: emit the function (header + body) and unshift
    /// the `const $ = _c(N);` declaration when slots are used. Outlined functions
    /// are emitted separately by the caller (they are appended at module end, not
    /// nested inside this function — see `compile_module`).
    fn codegen_function(&mut self, func: &ReactiveFunction, is_arrow: bool) -> String {
        // `enableResetCacheOnSourceFileChanges` (`CodegenReactiveFunction.ts:133-146`):
        // when the source hash is known, reserve a cache slot for it via
        // `cacheIndex = cx.nextCacheIndex` BEFORE codegen runs, so every reactive
        // scope below allocates from slot 1 onward (the hash always occupies slot 0).
        let fast_refresh_index = if self.fast_refresh_hash.is_some() {
            Some(self.next_cache_index())
        } else {
            None
        };

        let mut body = self.codegen_reactive_function(func);

        // `enableEmitHookGuards` (`CodegenReactiveFunction.ts:150-159`): wrap the
        // whole body (everything after the leading directives) in a `try {
        // <fn>(0); … } finally { <fn>(1); }` guard. This runs BEFORE the cache
        // preface is inserted, so the `const $ = _c(N)` lands ABOVE the try (the TS
        // unshifts the preface after the `compiled.body` wrap).
        if let Some(guard_fn) = self.hook_guard.clone() {
            let directives = Self::leading_directive_count(func, &body);
            let wrapped = wrap_hook_guard_try(&guard_fn, body.split_off(directives));
            body.push(wrapped);
        }

        // Preamble: `const $ = _c(N);` if any cache slots were used. Insert it
        // after any leading directives (directives always print first).
        if self.cache_count != 0 {
            let cache_count = self.cache_count;
            let cache = self.cache();
            let import_name = self.cache_import_name.clone();
            let mut at = Self::leading_directive_count(func, &body);
            body.insert(at, format!("const {cache} = {import_name}({cache_count});"));
            at += 1;

            // `enableResetCacheOnSourceFileChanges` (`CodegenReactiveFunction.ts:180-243`):
            // immediately after the cache declaration, emit the fast-refresh guard
            // that resets every slot to the memo sentinel when the stored source
            // hash differs, then records the new hash. Only emitted when the
            // function uses the cache at all (`cacheCount !== 0`), which the
            // reserved slot 0 already guarantees here.
            if let (Some(index), Some(hash)) = (fast_refresh_index, self.fast_refresh_hash.clone()) {
                let i = self.synthesize_name("$i");
                let reset_block = format!(
                    "if ({cache}[{index}] !== \"{hash}\") {{\n\
                     for (let {i} = 0; {i} < {cache_count}; {i} += 1) {{\n\
                     {cache}[{i}] = Symbol.for(\"{sentinel}\");\n\
                     }}\n\
                     {cache}[{index}] = \"{hash}\";\n\
                     }}",
                    sentinel = MEMO_CACHE_SENTINEL,
                );
                body.insert(at, reset_block);
            }
        }

        // `enableEmitInstrumentForget` (`CodegenReactiveFunction.ts:247-307`):
        // unshift an `if (<gates>) <fn>("<id>", "<filepath>");` instrumentation call
        // onto the body for a *named* function. In the TS this is unshifted AFTER the
        // `const $ = _c(N)` preface, so it lands ABOVE the cache line; we insert it at
        // the same post-directive position after the cache insertion to match.
        if let Some(instrument) = self.instrument_forget.clone()
            && let Some(id) = func.id.as_deref()
        {
            let call = format!(
                "{}(\"{}\", \"{}\");",
                instrument.instrument_fn_local, id, instrument.virtual_filepath
            );
            let stmt = format!("if ({}) {}", instrument.if_test, call);
            body.insert(Self::leading_directive_count(func, &body), stmt);
        }

        if is_arrow {
            let params = func
                .params
                .iter()
                .map(|p| self.convert_parameter(p))
                .collect::<Vec<_>>()
                .join(", ");
            let async_ = if func.async_ { "async " } else { "" };
            format!("{async_}({params}) => {{\n{}\n}}", body.join("\n"))
        } else {
            let header = self.function_header(func);
            format!("{header} {{\n{}\n}}", body.join("\n"))
        }
    }

    /// Emit one outlined function (a fresh cache namespace, the
    /// labels/lvalues/hoisted-contexts subset of passes + renameVariables, then
    /// codegen) — mirroring the `getOutlinedFunctions()` loop in the TS.
    fn codegen_outlined(&mut self, outlined_fn: &HirFunction) -> String {
        let mut reactive = crate::reactive_scopes::build_reactive_function(outlined_fn);
        crate::reactive_scopes::prune_unused_labels(&mut reactive);
        crate::reactive_scopes::prune_unused_lvalues(&mut reactive);
        crate::reactive_scopes::prune_hoisted_contexts(&mut reactive);
        let identifiers = crate::reactive_scopes::rename_variables(&mut reactive);

        // An outlined function never contains an fbt/macro operand (such operands
        // are excluded from outlining by `OutlineFunctions`), so its emitter gets an
        // empty `fbtOperands` set.
        let mut emitter = Emitter::with_cache_import_name(
            identifiers,
            self.cache_import_name.clone(),
            HashSet::new(),
            self.enable_name_anonymous_functions,
        );
        let mut body = emitter.codegen_reactive_function(&reactive);
        if emitter.cache_count != 0 {
            let cache = emitter.cache();
            let import_name = emitter.cache_import_name.clone();
            let at = Self::leading_directive_count(&reactive, &body);
            body.insert(at, format!("const {cache} = {import_name}({});", emitter.cache_count));
        }
        if emitter.cache_count > 0 {
            self.cache_count = self.cache_count.max(1); // ensure the import is emitted
        }
        let header = emitter.function_header(&reactive);
        let flat = format!("{header} {{\n{}\n}}", body.join("\n"));

        // `Program.ts` re-queues an outlined fn registered with a non-null
        // `ReactFunctionType` (`OutlineJSX` uses `'Component'`): the inserted flat
        // source is re-compiled as a top-level Component, which is what
        // materializes the outlined component's internal reactive scopes
        // (`_c(N)`). `OutlineFunctions` registers `null` → its outlined closures
        // are emitted flat (no re-compilation). We mark JSX-outlined components
        // with `fn_type == Component` (see `outline_jsx::emit_outlined_fn`).
        if outlined_fn.fn_type == crate::hir::model::ReactFunctionType::Component {
            let recompiled = recompile_outlined_component(&flat, &self.cache_import_name);
            // The re-compiled component may introduce its own cache slots even when
            // the flat build had none; ensure the shared runtime import is emitted.
            if recompiled.contains(&format!("{}(", self.cache_import_name)) {
                self.cache_count = self.cache_count.max(1);
            }
            return recompiled;
        }
        flat
    }

    fn function_header(&self, func: &ReactiveFunction) -> String {
        let name = func.id.as_deref().unwrap_or("");
        let params = func
            .params
            .iter()
            .map(|p| self.convert_parameter(p))
            .collect::<Vec<_>>()
            .join(", ");
        let async_ = if func.async_ { "async " } else { "" };
        let generator = if func.generator { "*" } else { "" };
        format!("{async_}function{generator} {name}({params})")
    }

    fn convert_parameter(&self, param: &FunctionParam) -> String {
        match param {
            FunctionParam::Place(place) => convert_identifier(&place.identifier),
            FunctionParam::Spread(spread) => {
                format!("...{}", convert_identifier(&spread.place.identifier))
            }
        }
    }

    /// `codegenReactiveFunction`: declare the params, codegen the body, then trim
    /// a trailing bare `return;`.
    fn codegen_reactive_function(&mut self, func: &ReactiveFunction) -> Vec<String> {
        for param in &func.params {
            let place = match param {
                FunctionParam::Place(p) => p,
                FunctionParam::Spread(s) => &s.place,
            };
            self.temp.insert(place.identifier.declaration_id, None);
            self.declare(&place.identifier);
        }
        let mut statements = self.codegen_block(&func.body);
        // Trim a trailing `return;` (implicit-undefined return).
        if statements.last().map(|s| s.trim()) == Some("return;") {
            statements.pop();
        }
        // Prepend the function's directives (`'use strict'`, `'worklet'`, …). In
        // Babel these are `body.directives`, which always print at the top of the
        // block before any statement (TS `codegenReactiveFunction` line 345). The
        // `const $ = _c(N)` cache preface is inserted *after* the directives by
        // the callers (see `codegen_function` / `codegen_outlined`, which skip the
        // leading directive lines).
        for directive in func.directives.iter().rev() {
            statements.insert(0, format!("\"{directive}\";"));
        }
        statements
    }

    /// Count the leading directive statements in a codegen'd body so the cache
    /// preface can be inserted *after* them (Babel always prints `body.directives`
    /// before the first statement).
    fn leading_directive_count(func: &ReactiveFunction, body: &[String]) -> usize {
        func.directives.len().min(body.len())
    }

    // --- blocks ------------------------------------------------------------

    /// `codegenBlock`: snapshot/restore temporaries around the block.
    fn codegen_block(&mut self, block: &ReactiveBlock) -> Vec<String> {
        let saved = self.temp.clone();
        let result = self.codegen_block_no_reset(block);
        // Restore: keep only entries that existed before (TS invariants existing
        // temporaries are unchanged; we simply restore the snapshot).
        self.temp = saved;
        result
    }

    fn codegen_block_no_reset(&mut self, block: &ReactiveBlock) -> Vec<String> {
        let mut statements: Vec<String> = Vec::new();
        for item in block {
            match item {
                ReactiveStatement::Instruction(instr) => {
                    if let Some(stmt) = self.codegen_instruction_nullable(instr) {
                        statements.push(stmt);
                    }
                }
                ReactiveStatement::PrunedScope(block) => {
                    let inner = self.codegen_block_no_reset(&block.instructions);
                    statements.extend(inner);
                }
                ReactiveStatement::Scope(block) => {
                    let saved = self.temp.clone();
                    self.codegen_reactive_scope(
                        &mut statements,
                        &block.scope,
                        &block.instructions,
                    );
                    self.temp = saved;
                }
                ReactiveStatement::Terminal(stmt) => {
                    let Some(result) = self.codegen_terminal(&stmt.terminal) else {
                        continue;
                    };
                    match &stmt.label {
                        Some(label) if !label.implicit => {
                            // Wrap in a labeled statement. A single-statement block
                            // is unwrapped first (matches the TS).
                            let inner = match result {
                                TermResult::Block(inner) if inner.len() == 1 => {
                                    inner.into_iter().next().unwrap()
                                }
                                TermResult::Block(inner) => {
                                    format!("{{\n{}\n}}", inner.join("\n"))
                                }
                                TermResult::Stmt(s) => s,
                            };
                            statements.push(format!("bb{}: {}", label.id.as_u32(), inner));
                        }
                        _ => match result {
                            // A bare block statement (Label) is spread inline.
                            TermResult::Block(inner) => statements.extend(inner),
                            TermResult::Stmt(s) => statements.push(s),
                        },
                    }
                }
            }
        }
        statements
    }

    // --- reactive scope (memoization) --------------------------------------

    fn codegen_reactive_scope(
        &mut self,
        statements: &mut Vec<String>,
        scope: &ReactiveScope,
        block: &ReactiveBlock,
    ) {
        let mut cache_store_statements: Vec<String> = Vec::new();
        let mut change_expressions: Vec<String> = Vec::new();
        // (name, index)
        let mut cache_loads: Vec<(String, u32)> = Vec::new();

        // Dependencies, sorted by qualified name.
        let mut deps: Vec<&ReactiveScopeDependency> = scope.dependencies.iter().collect();
        deps.sort_by(|a, b| compare_dependency(a, b));
        for dep in &deps {
            let index = self.next_cache_index();
            let cache = self.cache();
            let dep_expr = self.codegen_dependency(dep);
            change_expressions.push(format!("{cache}[{index}] !== {dep_expr}"));
            cache_store_statements.push(format!("{cache}[{index}] = {dep_expr};"));
        }

        let mut first_output_index: Option<u32> = None;

        // Declarations, sorted by name.
        let mut decls: Vec<&Identifier> = scope
            .declarations
            .iter()
            .map(|(_, d)| &d.identifier)
            .collect();
        decls.sort_by(|a, b| identifier_name(a).cmp(&identifier_name(b)));
        for identifier in decls {
            let index = self.next_cache_index();
            if first_output_index.is_none() {
                first_output_index = Some(index);
            }
            let name = convert_identifier(identifier);
            if !self.has_declared(identifier) {
                statements.push(format!("let {name};"));
            }
            cache_loads.push((name, index));
            self.declare(identifier);
        }
        for reassignment in &scope.reassignments {
            let index = self.next_cache_index();
            if first_output_index.is_none() {
                first_output_index = Some(index);
            }
            let name = convert_identifier(reassignment);
            cache_loads.push((name, index));
        }

        // Test condition: OR of change expressions, or the sentinel form.
        let test_condition = if change_expressions.is_empty() {
            let cache = self.cache();
            let index = first_output_index.expect("scope must have a declaration");
            format!(
                "{cache}[{index}] === Symbol.for(\"{MEMO_CACHE_SENTINEL}\")"
            )
        } else {
            change_expressions.join(" || ")
        };

        let mut computation_block = self.codegen_block(block);

        let mut cache_load_statements: Vec<String> = Vec::new();
        for (name, index) in &cache_loads {
            let cache = self.cache();
            cache_store_statements.push(format!("{cache}[{index}] = {name};"));
            cache_load_statements.push(format!("{name} = {cache}[{index}];"));
        }
        computation_block.extend(cache_store_statements);

        statements.push(format!(
            "if ({test_condition}) {{\n{}\n}} else {{\n{}\n}}",
            computation_block.join("\n"),
            cache_load_statements.join("\n")
        ));

        if let Some(early) = &scope.early_return_value {
            let name = convert_identifier(&early.value);
            statements.push(format!(
                "if ({name} !== Symbol.for(\"{EARLY_RETURN_SENTINEL}\")) {{\nreturn {name};\n}}"
            ));
        }
    }

    fn codegen_dependency(&mut self, dep: &ReactiveScopeDependency) -> String {
        let mut object = convert_identifier(&dep.identifier);
        if !dep.path.is_empty() {
            let has_optional = dep.path.iter().any(|p| p.optional);
            for entry in &dep.path {
                let (prop, computed) = match &entry.property {
                    PropertyLiteral::String(s) => (s.clone(), false),
                    PropertyLiteral::Number(n) => (format_number(*n), true),
                };
                if has_optional {
                    let op = if entry.optional { "?." } else { "" };
                    if computed {
                        object = format!("{object}{op}[{prop}]");
                    } else if entry.optional {
                        object = format!("{object}?.{prop}");
                    } else {
                        object = format!("{object}.{prop}");
                    }
                } else if computed {
                    object = format!("{object}[{prop}]");
                } else {
                    object = format!("{object}.{prop}");
                }
            }
        }
        object
    }

    // --- terminals ---------------------------------------------------------

    fn codegen_terminal(&mut self, terminal: &ReactiveTerminal) -> Option<TermResult> {
        // The `Label` terminal produces a bare block whose statement count must be
        // known exactly for the labeled-statement unwrap, so it returns
        // `TermResult::Block`; every other terminal returns a single `Stmt`.
        if let ReactiveTerminal::Label { block, .. } = terminal {
            return Some(TermResult::Block(self.codegen_block(block)));
        }
        let s = self.codegen_terminal_string(terminal)?;
        Some(TermResult::Stmt(s))
    }

    fn codegen_terminal_string(&mut self, terminal: &ReactiveTerminal) -> Option<String> {
        match terminal {
            ReactiveTerminal::Break { target_kind, target, .. } => match target_kind {
                ReactiveTerminalTargetKind::Implicit => None,
                ReactiveTerminalTargetKind::Labeled => {
                    Some(format!("break bb{};", target.as_u32()))
                }
                ReactiveTerminalTargetKind::Unlabeled => Some("break;".to_string()),
            },
            ReactiveTerminal::Continue { target_kind, target, .. } => match target_kind {
                ReactiveTerminalTargetKind::Implicit => None,
                ReactiveTerminalTargetKind::Labeled => {
                    Some(format!("continue bb{};", target.as_u32()))
                }
                ReactiveTerminalTargetKind::Unlabeled => Some("continue;".to_string()),
            },
            ReactiveTerminal::Return { value, .. } => {
                let expr = self.codegen_place_to_expression(value);
                if expr == "undefined" {
                    Some("return;".to_string())
                } else {
                    Some(format!("return {expr};"))
                }
            }
            ReactiveTerminal::Throw { value, .. } => {
                Some(format!("throw {};", self.codegen_place_to_expression(value)))
            }
            ReactiveTerminal::If { test, consequent, alternate, .. } => {
                let test_expr = self.codegen_place_to_expression(test);
                let cons = self.codegen_block(consequent);
                let mut out = format!("if ({test_expr}) {{\n{}\n}}", cons.join("\n"));
                if let Some(alternate) = alternate {
                    let alt = self.codegen_block(alternate);
                    if !alt.is_empty() {
                        out.push_str(&format!(" else {{\n{}\n}}", alt.join("\n")));
                    }
                }
                Some(out)
            }
            ReactiveTerminal::Switch { test, cases, .. } => {
                let test_expr = self.codegen_place_to_expression(test);
                let mut case_strs = Vec::new();
                for case in cases {
                    let label = match &case.test {
                        Some(t) => format!("case {}:", self.codegen_place_to_expression(t)),
                        None => "default:".to_string(),
                    };
                    let body = match &case.block {
                        Some(b) => self.codegen_block(b),
                        None => Vec::new(),
                    };
                    if body.is_empty() {
                        case_strs.push(label);
                    } else {
                        case_strs.push(format!("{label} {{\n{}\n}}", body.join("\n")));
                    }
                }
                Some(format!("switch ({test_expr}) {{\n{}\n}}", case_strs.join("\n")))
            }
            ReactiveTerminal::While { test, loop_, .. } => {
                let test_expr = self.codegen_instruction_value_to_expression(test);
                let body = self.codegen_block(loop_);
                Some(format!("while ({test_expr}) {{\n{}\n}}", body.join("\n")))
            }
            ReactiveTerminal::DoWhile { loop_, test, .. } => {
                let body = self.codegen_block(loop_);
                let test_expr = self.codegen_instruction_value_to_expression(test);
                Some(format!("do {{\n{}\n}} while ({test_expr});", body.join("\n")))
            }
            ReactiveTerminal::For { init, test, update, loop_, .. } => {
                let init_str = self.codegen_for_init(init);
                let test_str = self.codegen_instruction_value_to_expression(test);
                let update_str = update
                    .as_ref()
                    .map(|u| self.codegen_instruction_value_to_expression(u))
                    .unwrap_or_default();
                let body = self.codegen_block(loop_);
                Some(format!(
                    "for ({init_str}; {test_str}; {update_str}) {{\n{}\n}}",
                    body.join("\n")
                ))
            }
            ReactiveTerminal::ForIn { init, loop_, .. } => {
                self.codegen_for_in_of(init, None, loop_, true)
            }
            ReactiveTerminal::ForOf { init, test, loop_, .. } => {
                self.codegen_for_in_of(init, Some(test), loop_, false)
            }
            ReactiveTerminal::Label { block, .. } => {
                // Handled in `codegen_terminal` (returns `TermResult::Block`); this
                // arm exists only for exhaustiveness.
                let body = self.codegen_block(block);
                Some(format!("{{\n{}\n}}", body.join("\n")))
            }
            ReactiveTerminal::Try { block, handler_binding, handler, .. } => {
                let try_body = self.codegen_block(block);
                if let Some(binding) = handler_binding {
                    self.temp.insert(binding.identifier.declaration_id, None);
                }
                let handler_body = self.codegen_block(handler);
                let catch = match handler_binding {
                    Some(b) => format!("catch ({}) {{\n{}\n}}", convert_identifier(&b.identifier), handler_body.join("\n")),
                    None => format!("catch {{\n{}\n}}", handler_body.join("\n")),
                };
                Some(format!("try {{\n{}\n}} {catch}", try_body.join("\n")))
            }
        }
    }

    /// `codegenForInit`: a `SequenceExpression` init becomes a single variable
    /// declaration with one or more declarators; otherwise an expression.
    ///
    /// Ports the TS declarator-collapsing logic (`codegenForInit`,
    /// CodegenReactiveFunction.ts:1193-1244): the codegen'd body statements are a
    /// mix of `let x;`/`const x;` declarations and `x = expr;` assignments. Each
    /// assignment whose target matches the *last* uninitialized declarator folds
    /// into it (`let x; x = e` → `let x = e`); every other statement must be a
    /// `let`/`const` declaration that contributes new declarators. The final
    /// declaration's kind is `let` if any contributing declaration was `let`,
    /// else `const`. This produces `for (let i = 0, j = props.n; …)` for a
    /// multi-declarator init rather than the invalid
    /// `for (let i = 0; const j = …; …)`.
    fn codegen_for_init(&mut self, init: &ReactiveValue) -> String {
        if let ReactiveValue::Sequence(seq) = init {
            let block: ReactiveBlock = seq
                .instructions
                .iter()
                .map(|i| ReactiveStatement::Instruction(i.clone()))
                .collect();
            let stmts = self.codegen_block(&block);

            // (declarator-name, initializer-text). `init` is `None` until an
            // assignment folds into it.
            let mut declarators: Vec<(String, Option<String>)> = Vec::new();
            let mut kind = "const";
            for stmt in &stmts {
                let s = stmt.trim().trim_end_matches(';').trim();
                if let Some((name, decl_init, decl_kind)) = parse_for_init_declaration(s) {
                    if decl_kind == "let" {
                        kind = "let";
                    }
                    declarators.push((name, decl_init));
                } else if let Some((target, rhs)) = parse_for_init_assignment(s) {
                    // Fold `x = e` into the last uninitialized declarator named x.
                    if let Some(last) = declarators.last_mut() {
                        if last.0 == target && last.1.is_none() {
                            last.1 = Some(rhs);
                            continue;
                        }
                    }
                    // Fallback (shouldn't happen for valid for-inits): treat as a
                    // standalone declarator so we never emit invalid output.
                    declarators.push((target, Some(rhs)));
                }
            }

            if declarators.is_empty() {
                // Defensive: no parsable declaration — emit the raw joined text
                // (matches the old single-declarator path closely enough).
                return stmts.join(" ").trim_end().trim_end_matches(';').to_string();
            }

            let parts = declarators
                .iter()
                .map(|(name, init)| match init {
                    Some(v) => format!("{name} = {v}"),
                    None => name.clone(),
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("{kind} {parts}")
        } else {
            self.codegen_instruction_value_to_expression(init)
        }
    }

    fn codegen_for_in_of(
        &mut self,
        init: &ReactiveValue,
        test: Option<&ReactiveValue>,
        loop_: &ReactiveBlock,
        is_for_in: bool,
    ) -> Option<String> {
        // For-in: init is `SequenceExpression` with 2 instructions
        // [collection, item]. For-of: init is the GetIterator, test is a
        // `SequenceExpression` with 2 instructions [iteratorNext, item].
        let (collection_value, item_instr) = if is_for_in {
            let ReactiveValue::Sequence(seq) = init else {
                return Some(String::new());
            };
            if seq.instructions.len() != 2 {
                return Some(String::new());
            }
            (
                seq.instructions[0].value.clone(),
                seq.instructions[1].clone(),
            )
        } else {
            let ReactiveValue::Sequence(init_seq) = init else {
                return Some(String::new());
            };
            let collection = init_seq.instructions.first().map(|i| i.value.clone())?;
            let Some(ReactiveValue::Sequence(test_seq)) = test else {
                return Some(String::new());
            };
            if test_seq.instructions.len() != 2 {
                return Some(String::new());
            }
            (collection, test_seq.instructions[1].clone())
        };

        let (lval, kind) = match &item_instr.value {
            ReactiveValue::Instruction(iv) => match iv.as_ref() {
                InstructionValue::StoreLocal { lvalue, .. } => {
                    (self.codegen_lvalue_place(&lvalue.place), lvalue.kind)
                }
                InstructionValue::Destructure { lvalue, .. } => {
                    (self.codegen_lvalue_pattern(&lvalue.pattern), lvalue.kind)
                }
                _ => return Some(String::new()),
            },
            _ => return Some(String::new()),
        };
        let decl_kind = match kind {
            InstructionKind::Const => "const",
            InstructionKind::Let => "let",
            _ => "let",
        };
        let collection_expr = self.codegen_instruction_value_to_expression(&collection_value);
        let body = self.codegen_block(loop_);
        let op = if is_for_in { "in" } else { "of" };
        Some(format!(
            "for ({decl_kind} {lval} {op} {collection_expr}) {{\n{}\n}}",
            body.join("\n")
        ))
    }

    // --- instructions ------------------------------------------------------

    fn codegen_instruction_nullable(&mut self, instr: &ReactiveInstruction) -> Option<String> {
        // Store/Declare/Destructure handling.
        if let ReactiveValue::Instruction(iv) = &instr.value {
            match iv.as_ref() {
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    let mut kind = lvalue.kind;
                    if self.has_declared(&lvalue.place.identifier) {
                        kind = InstructionKind::Reassign;
                    }
                    let lval = LvalueTarget::Place(lvalue.place.clone());
                    let value_expr = Some(self.codegen_place_to_expression(value));
                    return self.emit_store(instr, kind, lval, value_expr);
                }
                InstructionValue::StoreContext { kind, place, value, .. } => {
                    let lval = LvalueTarget::Place(place.clone());
                    let value_expr = Some(self.codegen_place_to_expression(value));
                    return self.emit_store(instr, *kind, lval, value_expr);
                }
                InstructionValue::DeclareLocal { lvalue, .. } => {
                    if self.has_declared(&lvalue.place.identifier) {
                        return None;
                    }
                    let lval = LvalueTarget::Place(lvalue.place.clone());
                    return self.emit_store(instr, lvalue.kind, lval, None);
                }
                InstructionValue::DeclareContext { kind, place, .. } => {
                    if self.has_declared(&place.identifier) {
                        return None;
                    }
                    let lval = LvalueTarget::Place(place.clone());
                    return self.emit_store(instr, *kind, lval, None);
                }
                InstructionValue::Destructure { lvalue, value, .. } => {
                    // Register fresh temporaries in the pattern (for unnamed,
                    // non-reassign bindings).
                    if lvalue.kind != InstructionKind::Reassign {
                        for place in pattern_operands(&lvalue.pattern) {
                            if place.identifier.name.is_none() {
                                self.temp.insert(place.identifier.declaration_id, None);
                            }
                        }
                    }
                    let lval = LvalueTarget::Pattern(lvalue.pattern.clone());
                    let value_expr = Some(self.codegen_place_to_expression(value));
                    return self.emit_store(instr, lvalue.kind, lval, value_expr);
                }
                InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => {
                    return None;
                }
                InstructionValue::Debugger { .. } => {
                    return Some("debugger;".to_string());
                }
                InstructionValue::ObjectMethod { .. } => {
                    if let Some(lvalue) = &instr.lvalue {
                        self.object_methods
                            .insert(lvalue.identifier.id.as_u32(), iv.as_ref().clone());
                    }
                    return None;
                }
                // A statement-kind unsupported node (e.g. a `TSEnumDeclaration`)
                // is emitted verbatim as a statement regardless of its (unused)
                // temporary lvalue — `codegenInstruction`'s
                // `if (t.isStatement(value)) return value`.
                InstructionValue::UnsupportedNode { node, is_statement: true, .. } => {
                    return Some(node.clone());
                }
                _ => {}
            }
        }
        // General case.
        let value = self.codegen_instruction_value(&instr.value);
        self.codegen_instruction(instr, value)
    }

    /// Emit a Store/Declare/Destructure given the resolved kind, lvalue target,
    /// and optional value. Mirrors the switch on `kind` in
    /// `codegenInstructionNullable`.
    fn emit_store(
        &mut self,
        instr: &ReactiveInstruction,
        kind: InstructionKind,
        lvalue: LvalueTarget,
        value: Option<String>,
    ) -> Option<String> {
        match kind {
            InstructionKind::Const => {
                let lval = self.codegen_lvalue_target(&lvalue);
                match value {
                    Some(v) => Some(format!("const {lval} = {v};")),
                    None => Some(format!("const {lval};")),
                }
            }
            InstructionKind::Let => {
                let lval = self.codegen_lvalue_target(&lvalue);
                match value {
                    Some(v) => Some(format!("let {lval} = {v};")),
                    None => Some(format!("let {lval};")),
                }
            }
            InstructionKind::Function => {
                // A function declaration: the value is a function expression; emit
                // it as a declaration with the lvalue name.
                let lval = self.codegen_lvalue_target(&lvalue);
                let v = value.unwrap_or_default();
                Some(rewrite_function_expression_to_declaration(&lval, &v))
            }
            InstructionKind::Reassign => {
                let lval = self.codegen_lvalue_target(&lvalue);
                let v = value.unwrap_or_default();
                let expr = format!("{lval} = {v}");
                if let Some(lv) = &instr.lvalue {
                    // A reassignment feeding a temporary lvalue (non-context):
                    // store the expression in temp, emit nothing.
                    if !matches!(&instr.value, ReactiveValue::Instruction(iv) if matches!(iv.as_ref(), InstructionValue::StoreContext { .. }))
                    {
                        self.temp.insert(
                            lv.identifier.declaration_id,
                            Some(Temp::Expr(expr)),
                        );
                        return None;
                    }
                    return self.codegen_instruction(instr, Temp::Expr(expr));
                }
                Some(emit_expression_statement(&expr))
            }
            // The catch-binding `DeclareLocal(Catch)` emits a bare empty
            // statement (TS `codegenInstructionNullable` returns
            // `t.emptyStatement()`, NOT null). `codegen_block_no_reset` keeps it,
            // so a `;` is printed where the binding sits (immediately before the
            // `try`); dropping it would miscompile the leading `;` and corrupt
            // labeled-block structure around the try.
            InstructionKind::Catch => Some(";".to_string()),
            InstructionKind::HoistedConst
            | InstructionKind::HoistedLet
            | InstructionKind::HoistedFunction => None,
        }
    }

    /// `codegenInstruction`: decide statement form for a computed value —
    /// expression statement (no lvalue), temporary capture (unnamed lvalue), or
    /// const declaration / reassignment (named lvalue).
    fn codegen_instruction(&mut self, instr: &ReactiveInstruction, value: Temp) -> Option<String> {
        match &instr.lvalue {
            None => {
                let expr = temp_to_expr(&value);
                Some(emit_expression_statement(&expr))
            }
            Some(lvalue) if lvalue.identifier.name.is_none() => {
                self.temp.insert(lvalue.identifier.declaration_id, Some(value));
                None
            }
            Some(lvalue) => {
                let expr = temp_to_expr(&value);
                let name = convert_identifier(&lvalue.identifier);
                if self.has_declared(&lvalue.identifier) {
                    Some(format!("{name} = {expr};"))
                } else {
                    Some(format!("const {name} = {expr};"))
                }
            }
        }
    }

    // --- values ------------------------------------------------------------

    fn codegen_instruction_value_to_expression(&mut self, value: &ReactiveValue) -> String {
        let v = self.codegen_instruction_value(value);
        temp_to_expr(&v)
    }

    fn codegen_instruction_value(&mut self, value: &ReactiveValue) -> Temp {
        match value {
            ReactiveValue::Logical(l) => {
                let op = l.operator.as_str();
                let left = self.codegen_instruction_value_to_expression(&l.left);
                let right = self.codegen_instruction_value_to_expression(&l.right);
                // `LogicalExpression` parenthesization (babel `BinaryLike`): a
                // looser operand is wrapped. `??` may not mix unparenthesized
                // with `&&`/`||`, so a `&&`/`||` operand under `??` (and vice
                // versa) is always wrapped (babel `BinaryLike` line 105).
                let prec = binary_operator_precedence(op).unwrap_or(0);
                let wrap_logical = |operand: &str, is_right: bool| -> String {
                    let kind = classify_expr(operand);
                    let mix = matches!(kind, ExprKind::Binary(p)
                        if (p == 1) != (prec == 1));
                    if mix {
                        return format!("({operand})");
                    }
                    wrap_binary_operand(operand, prec, is_right)
                };
                let left = wrap_logical(&left, false);
                let right = wrap_logical(&right, true);
                Temp::Expr(format!("{left} {op} {right}"))
            }
            ReactiveValue::Ternary(t) => {
                let test = self.codegen_instruction_value_to_expression(&t.test);
                let cons = self.codegen_instruction_value_to_expression(&t.consequent);
                let alt = self.codegen_instruction_value_to_expression(&t.alternate);
                // `ConditionalExpression` parenthesization (babel
                // `parentheses.js`): the test wraps a conditional/assignment/
                // sequence (a nested `a ? b : c` test reads ambiguously);
                // consequent/alternate are themselves expression positions that
                // do not need wrapping for these constructs.
                let test = wrap_cond_or_looser(&test);
                Temp::Expr(format!("{test} ? {cons} : {alt}"))
            }
            ReactiveValue::Sequence(seq) => {
                let block: ReactiveBlock = seq
                    .instructions
                    .iter()
                    .map(|i| ReactiveStatement::Instruction(i.clone()))
                    .collect();
                let stmts = self.codegen_block_no_reset(&block);
                let mut exprs: Vec<String> = stmts
                    .iter()
                    .map(|s| s.trim_end_matches(';').to_string())
                    .collect();
                // Preserve the structured final value (a `Member`/`Call`) so an
                // enclosing `OptionalExpression` can still rebuild the optional
                // access; only flatten when there are preceding sequence members.
                let final_value = self.codegen_instruction_value(&seq.value);
                if exprs.is_empty() {
                    final_value
                } else {
                    exprs.push(temp_to_expr(&final_value));
                    Temp::Expr(format!("({})", exprs.join(", ")))
                }
            }
            ReactiveValue::OptionalCall(opt) => {
                // Resolve the inner value structurally (a member access or a call),
                // then rebuild the *top-level* access as an optional-chain node,
                // mirroring `t.optionalMemberExpression` / `t.optionalCallExpression`
                // built from the resolved expression in the TS
                // (`CodegenReactiveFunction.ts` `case 'OptionalExpression'`). The TS
                // *always* produces an optional-chain node here — even when
                // `instrValue.optional === false` (a `.prop` link that continues the
                // chain) — so babel never parenthesizes its optional-chain object.
                // We track this with `optional_depth` so a member on the inner value
                // does not wrap, and tag the result `OptionalChain` so a *plain*
                // (top-level, depth-0) member later applied to it does wrap.
                self.optional_depth += 1;
                let inner = self.codegen_instruction_value(&opt.value);
                self.optional_depth -= 1;
                match inner {
                    Temp::Member { object, property, computed } => {
                        if computed {
                            let op = if opt.optional { "?.[" } else { "[" };
                            Temp::OptionalChain(format!("{object}{op}{property}]"))
                        } else {
                            let op = if opt.optional { "?." } else { "." };
                            Temp::OptionalChain(format!("{object}{op}{property}"))
                        }
                    }
                    Temp::Call { callee, args } => {
                        let callee = wrap_callee(&callee);
                        let op = if opt.optional { "?.(" } else { "(" };
                        Temp::OptionalChain(format!("{callee}{op}{args})"))
                    }
                    // An inner value that already rendered as a chain (or any other
                    // expression) is preserved as a chain so a top-level member on it
                    // still parenthesizes.
                    Temp::OptionalChain(s) => Temp::OptionalChain(s),
                    other => Temp::OptionalChain(temp_to_expr(&other)),
                }
            }
            ReactiveValue::Instruction(iv) => self.codegen_base_value(iv),
        }
    }

    fn codegen_base_value(&mut self, value: &InstructionValue) -> Temp {
        match value {
            InstructionValue::Primitive { value, .. } => Temp::Expr(codegen_primitive(value)),
            InstructionValue::JsxText { value, .. } => Temp::JsxText(value.clone()),
            InstructionValue::LoadLocal { place, .. }
            | InstructionValue::LoadContext { place, .. } => {
                // Return the structured temp (a `Member`/`Call` survives) so an
                // enclosing `OptionalExpression` can still rebuild the optional
                // access from the resolved member/call.
                self.codegen_place(place)
            }
            InstructionValue::LoadGlobal { binding, .. } => {
                Temp::Expr(non_local_binding_name(binding))
            }
            InstructionValue::StoreGlobal { name, value, .. } => {
                Temp::Expr(format!("{name} = {}", self.codegen_place_to_expression(value)))
            }
            InstructionValue::BinaryExpression { operator, left, right, .. } => {
                let l = self.codegen_place_to_expression(left);
                let r = self.codegen_place_to_expression(right);
                // Parenthesize looser operands exactly as babel-generator does
                // (`parentheses.js`): a child assignment/conditional/sequence, or
                // a lower-precedence (or equal-precedence right) binary, is
                // wrapped so the re-parse yields the same AST.
                let prec = binary_operator_precedence(operator).unwrap_or(0);
                let l = wrap_binary_operand(&l, prec, false);
                let r = wrap_binary_operand(&r, prec, true);
                Temp::Expr(format!("{l} {operator} {r}"))
            }
            InstructionValue::UnaryExpression { operator, value, .. } => {
                // Word operators (`typeof`, `void`, `delete`) need a trailing
                // space before the operand; symbol operators (`!`, `-`, `+`, `~`)
                // do not. Babel's `t.unaryExpression` handles this; the raw
                // concatenation otherwise emits `typeoffirstArg`.
                let operand = self.codegen_place_to_expression(value);
                let sep = if operator.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                    " "
                } else {
                    ""
                };
                Temp::Expr(format!("{operator}{sep}{operand}"))
            }
            InstructionValue::ArrayExpression { elements, .. } => {
                let items = elements
                    .iter()
                    .map(|e| match e {
                        ArrayElement::Place(p) => self.codegen_place_to_expression(p),
                        ArrayElement::Spread(s) => {
                            format!("...{}", self.codegen_place_to_expression(&s.place))
                        }
                        // A hole is `null` in the babel AST (a hole slot). It
                        // renders as an empty slot between commas.
                        ArrayElement::Hole => String::new(),
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                // A TRAILING hole needs an explicit final comma: joining produces
                // `a, , c, ` for `[a, , c, ,]`, but JS reads a single trailing
                // comma as "no trailing element" (length 3), dropping the hole.
                // Append a comma so the elision count (and `.length`) is preserved
                // exactly as babel emits it.
                let trailing = matches!(elements.last(), Some(ArrayElement::Hole));
                if trailing {
                    Temp::Expr(format!("[{items},]"))
                } else {
                    Temp::Expr(format!("[{items}]"))
                }
            }
            InstructionValue::CallExpression { callee, args, .. } => {
                let callee_str = wrap_callee(&self.codegen_place_to_expression(callee));
                let args_str = self.codegen_args(args);
                // `createCallExpression`: a hook call under `enableEmitHookGuards`
                // (client mode) is wrapped in a guard IIFE rather than emitted bare.
                if let Some(iife) =
                    self.maybe_hook_guard_iife(&callee.identifier, &callee_str, &args_str)
                {
                    return Temp::Expr(iife);
                }
                Temp::Call { callee: callee_str, args: args_str }
            }
            InstructionValue::MethodCall { property, args, .. } => {
                let member = self.codegen_place_to_expression(property);
                let args_str = self.codegen_args(args);
                if let Some(iife) =
                    self.maybe_hook_guard_iife(&property.identifier, &member, &args_str)
                {
                    return Temp::Expr(iife);
                }
                Temp::Call { callee: member, args: args_str }
            }
            InstructionValue::NewExpression { callee, args, .. } => {
                let callee_str = wrap_callee(&self.codegen_place_to_expression(callee));
                let args_str = self.codegen_args(args);
                Temp::Expr(format!("new {callee_str}({args_str})"))
            }
            InstructionValue::PropertyLoad { object, property, .. } => {
                let obj = self.codegen_member_object(object);
                match property {
                    PropertyLiteral::String(s) => Temp::Member {
                        object: obj,
                        property: s.clone(),
                        computed: false,
                    },
                    PropertyLiteral::Number(n) => Temp::Member {
                        object: obj,
                        property: format_number(*n),
                        computed: true,
                    },
                }
            }
            InstructionValue::PropertyStore { object, property, value, .. } => {
                let member = self.member_expr(object, property);
                Temp::Expr(format!("{member} = {}", self.codegen_place_to_expression(value)))
            }
            InstructionValue::PropertyDelete { object, property, .. } => {
                Temp::Expr(format!("delete {}", self.member_expr(object, property)))
            }
            InstructionValue::ComputedLoad { object, property, .. } => {
                let obj = self.codegen_member_object(object);
                let prop = self.codegen_place_to_expression(property);
                Temp::Member { object: obj, property: prop, computed: true }
            }
            InstructionValue::ComputedStore { object, property, value, .. } => {
                let obj = wrap_member_object(&self.codegen_place_to_expression(object));
                let prop = self.codegen_place_to_expression(property);
                let v = self.codegen_place_to_expression(value);
                Temp::Expr(format!("{obj}[{prop}] = {v}"))
            }
            InstructionValue::ComputedDelete { object, property, .. } => {
                let obj = wrap_member_object(&self.codegen_place_to_expression(object));
                let prop = self.codegen_place_to_expression(property);
                Temp::Expr(format!("delete {obj}[{prop}]"))
            }
            InstructionValue::ObjectExpression { properties, .. } => {
                Temp::Expr(self.codegen_object_expression(properties))
            }
            InstructionValue::JsxExpression { tag, props, children, .. } => {
                Temp::Expr(self.codegen_jsx_expression(tag, props, children.as_deref()))
            }
            InstructionValue::JsxFragment { children, .. } => {
                let kids = children
                    .iter()
                    .map(|c| self.codegen_jsx_child(c))
                    .collect::<Vec<_>>()
                    .join("");
                Temp::Expr(format!("<>{kids}</>"))
            }
            InstructionValue::FunctionExpression {
                name, name_hint, lowered_func, function_type, ..
            } => {
                let mut expr = self.codegen_function_expression(
                    name.as_deref(),
                    &lowered_func.func,
                    *function_type,
                );
                // `enableNameAnonymousFunctions` + an anonymous fn with a
                // `nameHint`: wrap in `{ "<hint>": <fn> }["<hint>"]` so the engine
                // infers the descriptive `.name` (CodegenReactiveFunction.ts).
                if self.enable_name_anonymous_functions && name.is_none() {
                    if let Some(hint) = name_hint {
                        let key = format!("\"{}\"", escape_string(hint));
                        expr = format!("{{ {key}: {expr} }}[{key}]");
                    }
                }
                Temp::Expr(expr)
            }
            InstructionValue::TemplateLiteral { subexprs, quasis, .. } => {
                Temp::Expr(self.codegen_template(quasis, subexprs))
            }
            InstructionValue::TaggedTemplateExpression { tag, value, .. } => {
                let tag_str = self.codegen_place_to_expression(tag);
                Temp::Expr(format!("{tag_str}`{}`", value.raw))
            }
            InstructionValue::Await { value, .. } => {
                Temp::Expr(format!("await {}", self.codegen_place_to_expression(value)))
            }
            InstructionValue::GetIterator { collection, .. } => {
                Temp::Expr(self.codegen_place_to_expression(collection))
            }
            InstructionValue::IteratorNext { iterator, .. } => {
                Temp::Expr(self.codegen_place_to_expression(iterator))
            }
            InstructionValue::NextPropertyOf { value, .. } => {
                Temp::Expr(self.codegen_place_to_expression(value))
            }
            InstructionValue::PostfixUpdate { lvalue, operation, .. } => {
                Temp::Expr(format!("{}{operation}", self.codegen_place_to_expression(lvalue)))
            }
            InstructionValue::PrefixUpdate { lvalue, operation, .. } => {
                Temp::Expr(format!("{operation}{}", self.codegen_place_to_expression(lvalue)))
            }
            InstructionValue::RegExpLiteral { pattern, flags, .. } => {
                Temp::Expr(format!("/{pattern}/{flags}"))
            }
            InstructionValue::MetaProperty { meta, property, .. } => {
                Temp::Expr(format!("{meta}.{property}"))
            }
            InstructionValue::TypeCastExpression {
                value, type_annotation, type_annotation_kind, ..
            } => {
                let v = self.codegen_place_to_expression(value);
                match type_annotation_kind {
                    crate::hir::value::TypeAnnotationKind::Satisfies => {
                        Temp::Expr(format!("{v} satisfies {type_annotation}"))
                    }
                    crate::hir::value::TypeAnnotationKind::As => {
                        Temp::Expr(format!("{v} as {type_annotation}"))
                    }
                    crate::hir::value::TypeAnnotationKind::Cast => Temp::Expr(v),
                }
            }
            InstructionValue::UnsupportedNode { node, .. } => Temp::Expr(node.clone()),
            // These are handled by codegen_instruction_nullable and never reach here.
            InstructionValue::StoreLocal { lvalue, value, .. } => {
                // `StoreLocal` in expression position (a reassignment used as a
                // value, e.g. `while ((item = items.pop()))`). The TS
                // `codegenInstructionValue` emits `t.assignmentExpression('=',
                // codegenLValue(lvalue.place), value)` here (the lvalue kind is
                // invariant `Reassign`); the LHS must be retained.
                let target = self.codegen_lvalue_place(&lvalue.place);
                let v = self.codegen_place_to_expression(value);
                Temp::Expr(format!("{target} = {v}"))
            }
            _ => Temp::Expr(String::new()),
        }
    }

    fn codegen_args(&mut self, args: &[CallArgument]) -> String {
        args.iter()
            .map(|a| match a {
                CallArgument::Place(p) => self.codegen_place_to_expression(p),
                CallArgument::Spread(s) => {
                    format!("...{}", self.codegen_place_to_expression(&s.place))
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn member_expr(&mut self, object: &Place, property: &PropertyLiteral) -> String {
        let obj = wrap_member_object(&self.codegen_place_to_expression(object));
        match property {
            PropertyLiteral::String(s) => format!("{obj}.{s}"),
            PropertyLiteral::Number(n) => format!("{obj}[{}]", format_number(*n)),
        }
    }

    fn codegen_object_expression(&mut self, properties: &[ObjectExpressionProperty]) -> String {
        let mut parts: Vec<String> = Vec::new();
        for prop in properties {
            match prop {
                ObjectExpressionProperty::Property(p) => match p.property_type {
                    PropertyType::Property => {
                        let key = self.codegen_object_property_key(&p.key);
                        let value = self.codegen_place_to_expression(&p.place);
                        let computed = matches!(p.key, ObjectPropertyKey::Computed { .. });
                        if computed {
                            parts.push(format!("[{key}]: {value}"));
                        } else if is_shorthand(&p.key, &value) {
                            parts.push(key);
                        } else {
                            parts.push(format!("{key}: {value}"));
                        }
                    }
                    PropertyType::Method => {
                        let key = self.codegen_object_property_key(&p.key);
                        let method = self.object_methods.get(&p.place.identifier.id.as_u32()).cloned();
                        if let Some(InstructionValue::ObjectMethod { lowered_func, .. }) = method {
                            let body = self.codegen_method_body(&lowered_func.func);
                            parts.push(format!("{key}{body}"));
                        }
                    }
                },
                ObjectExpressionProperty::Spread(s) => {
                    parts.push(format!("...{}", self.codegen_place_to_expression(&s.place)));
                }
            }
        }
        if parts.is_empty() {
            "{}".to_string()
        } else {
            format!("{{ {} }}", parts.join(", "))
        }
    }

    fn codegen_object_property_key(&mut self, key: &ObjectPropertyKey) -> String {
        match key {
            // babel-generator prints a string-literal object key without quotes
            // when its value is a valid `IdentifierName` (reserved words are
            // allowed as object keys, e.g. `class:`), so `{ "foo": x }` /
            // `{ ["foo"]: x }` (lowered to a `string` key) reprints as `foo:`.
            ObjectPropertyKey::String { name } if is_identifier_name(name) => name.clone(),
            ObjectPropertyKey::String { name } => format!("\"{name}\""),
            ObjectPropertyKey::Identifier { name } => name.clone(),
            ObjectPropertyKey::Number { name } => format_number(*name),
            ObjectPropertyKey::Computed { name } => self.codegen_place_to_expression(name),
        }
    }

    fn codegen_method_body(&mut self, func: &HirFunction) -> String {
        let mut reactive = crate::reactive_scopes::build_reactive_function(func);
        crate::reactive_scopes::prune_unused_labels(&mut reactive);
        crate::reactive_scopes::prune_unused_lvalues(&mut reactive);
        // Object methods share the parent's temporaries and uniqueIdentifiers.
        let stmts = self.codegen_reactive_function(&reactive);
        let params = reactive
            .params
            .iter()
            .map(|p| self.convert_parameter(p))
            .collect::<Vec<_>>()
            .join(", ");
        format!("({params}) {{\n{}\n}}", stmts.join("\n"))
    }

    fn codegen_function_expression(
        &mut self,
        name: Option<&str>,
        func: &HirFunction,
        function_type: crate::hir::value::FunctionExpressionType,
    ) -> String {
        let mut reactive = crate::reactive_scopes::build_reactive_function(func);
        crate::reactive_scopes::prune_unused_labels(&mut reactive);
        crate::reactive_scopes::prune_unused_lvalues(&mut reactive);
        crate::reactive_scopes::prune_hoisted_contexts(&mut reactive);
        // FunctionExpression shares the parent's temporaries + uniqueIdentifiers.
        let stmts = self.codegen_reactive_function(&reactive);
        let params = reactive
            .params
            .iter()
            .map(|p| self.convert_parameter(p))
            .collect::<Vec<_>>()
            .join(", ");

        use crate::hir::value::FunctionExpressionType as FT;
        match function_type {
            FT::ArrowFunctionExpression => {
                let async_ = if reactive.async_ { "async " } else { "" };
                // Hoist a single `return expr;` body into the concise expression
                // form (`() => expr`) when there are no directives, matching the TS
                // `codegenInstructionValue` arrow handling.
                if stmts.len() == 1 && reactive.directives.is_empty() {
                    if let Some(expr) = stmts[0]
                        .trim()
                        .strip_prefix("return ")
                        .and_then(|s| s.strip_suffix(';'))
                    {
                        // Parenthesize an object-literal body so it is not parsed as
                        // a block (matches babel's output).
                        let body = if expr.trim_start().starts_with('{') {
                            format!("({})", expr)
                        } else {
                            expr.to_string()
                        };
                        return format!("{async_}({params}) => {body}");
                    }
                }
                format!("{async_}({params}) => {{\n{}\n}}", stmts.join("\n"))
            }
            FT::FunctionExpression | FT::FunctionDeclaration => {
                let async_ = if reactive.async_ { "async " } else { "" };
                let generator = if reactive.generator { "*" } else { "" };
                let name_str = name.map(|n| format!(" {n}")).unwrap_or_default();
                format!("{async_}function{generator}{name_str}({params}) {{\n{}\n}}", stmts.join("\n"))
            }
        }
    }

    fn codegen_template(&mut self, quasis: &[TemplateQuasi], subexprs: &[Place]) -> String {
        let mut out = String::from("`");
        for (i, quasi) in quasis.iter().enumerate() {
            out.push_str(&quasi.raw);
            if i < subexprs.len() {
                let expr = self.codegen_place_to_expression(&subexprs[i]);
                out.push_str(&format!("${{{expr}}}"));
            }
        }
        out.push('`');
        out
    }

    // --- JSX ---------------------------------------------------------------

    fn codegen_jsx_expression(
        &mut self,
        tag: &JsxTag,
        props: &[JsxAttribute],
        children: Option<&[Place]>,
    ) -> String {
        let tag_str = match tag {
            JsxTag::Builtin(b) => b.name.clone(),
            JsxTag::Place(p) => {
                let resolved = self.codegen_place_to_expression(p);
                // A namespaced tag (`<svg:rect>`) lowers to a `Primitive` string
                // `"svg:rect"`, so the resolved expression is a quoted string
                // literal. The TS `JsxExpression` handler detects this
                // (`tagValue.type === 'StringLiteral'`) and converts it: with a
                // `:` it builds a `JSXNamespacedName` (`svg:rect`), otherwise a
                // bare `JSXIdentifier`. Either way the quotes must be dropped so
                // we don't emit invalid JSX (`<"svg:rect" …>`).
                if (resolved.starts_with('"') && resolved.ends_with('"'))
                    || (resolved.starts_with('\'') && resolved.ends_with('\''))
                {
                    strip_string_quotes(&resolved)
                } else {
                    resolved
                }
            }
        };
        let mut attrs = String::new();
        for attr in props {
            attrs.push(' ');
            attrs.push_str(&self.codegen_jsx_attribute(attr));
        }
        match children {
            None => format!("<{tag_str}{attrs} />"),
            Some(kids) => {
                let children_str = kids
                    .iter()
                    .map(|c| self.codegen_jsx_child(c))
                    .collect::<Vec<_>>()
                    .join("");
                format!("<{tag_str}{attrs}>{children_str}</{tag_str}>")
            }
        }
    }

    fn codegen_jsx_attribute(&mut self, attr: &JsxAttribute) -> String {
        match attr {
            JsxAttribute::Spread { argument } => {
                format!("{{...{}}}", self.codegen_place_to_expression(argument))
            }
            JsxAttribute::Attribute { name, place } => {
                // `cx.fbtOperands` exception: an fbt/macro operand string attribute
                // (e.g. `<fbt:param name="…">`) must stay bare/literal to satisfy
                // the fbt plugin, even if it contains chars that would otherwise
                // force an expression container.
                let is_fbt_operand = self.fbt_operands.contains(&place.identifier.id.as_u32());
                let value = self.codegen_place(place);
                match value {
                    Temp::JsxText(t) => format!("{name}={{\"{t}\"}}"),
                    Temp::Expr(ref e) if e.starts_with('"') || e.starts_with('\'') => {
                        // String literal attribute: emit bare unless it needs an
                        // expression container (control/unicode chars or quotes) and
                        // is not an fbt operand.
                        let raw = strip_string_quotes(e);
                        if jsx_string_requires_container(&raw) && !is_fbt_operand {
                            format!("{name}={{{e}}}")
                        } else if is_fbt_operand && raw.chars().any(|c| (c as u32) >= 0x80) {
                            // A bare fbt-operand attribute keeps the literal string
                            // (no expression container), but babel-generator's printer
                            // escapes any non-ASCII codepoint to `\uXXXX` (jsesc, the
                            // generator default). Mirror that so the bare attribute is
                            // byte-identical to the React Compiler's own output (e.g.
                            // `fbt-param-with-unicode`'s `name="user name ☺"`).
                            // A JSX attribute does NOT process `\u` escapes when re-
                            // parsed, but this matches babel-generator's actual emitted
                            // bytes — the faithful compiler-only oracle.
                            let quote = e.as_bytes()[0] as char;
                            format!("{name}={quote}{}{quote}", escape_non_ascii(&raw))
                        } else {
                            format!("{name}={e}")
                        }
                    }
                    other => format!("{name}={{{}}}", temp_to_expr(&other)),
                }
            }
        }
    }

    fn codegen_jsx_child(&mut self, place: &Place) -> String {
        let value = self.codegen_place(place);
        match value {
            Temp::JsxText(t) => {
                if t.chars().any(|c| matches!(c, '<' | '>' | '&' | '{' | '}')) {
                    format!("{{\"{t}\"}}")
                } else {
                    t
                }
            }
            other => {
                let e = temp_to_expr(&other);
                if e.starts_with('<') {
                    // A nested JSX element / fragment passes through bare.
                    e
                } else {
                    format!("{{{e}}}")
                }
            }
        }
    }

    // --- patterns & places -------------------------------------------------

    fn codegen_lvalue_target(&mut self, target: &LvalueTarget) -> String {
        match target {
            LvalueTarget::Place(p) => self.codegen_lvalue_place(p),
            LvalueTarget::Pattern(p) => self.codegen_lvalue_pattern(p),
        }
    }

    fn codegen_lvalue_place(&mut self, place: &Place) -> String {
        convert_identifier(&place.identifier)
    }

    fn codegen_lvalue_pattern(&mut self, pattern: &Pattern) -> String {
        match pattern {
            Pattern::Array(arr) => self.codegen_array_pattern(arr),
            Pattern::Object(obj) => self.codegen_object_pattern(obj),
        }
    }

    fn codegen_array_pattern(&mut self, pattern: &ArrayPattern) -> String {
        let items = pattern
            .items
            .iter()
            .map(|item| match item {
                ArrayPatternItem::Hole => String::new(),
                ArrayPatternItem::Place(p) => self.codegen_lvalue_place(p),
                ArrayPatternItem::Spread(s) => {
                    format!("...{}", self.codegen_lvalue_place(&s.place))
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!("[{items}]")
    }

    fn codegen_object_pattern(&mut self, pattern: &ObjectPattern) -> String {
        let parts = pattern
            .properties
            .iter()
            .map(|prop| match prop {
                ObjectPatternProperty::Property(ObjectProperty { key, place, .. }) => {
                    let key_str = self.codegen_object_property_key(key);
                    let value = self.codegen_lvalue_place(place);
                    let computed = matches!(key, ObjectPropertyKey::Computed { .. });
                    if computed {
                        format!("[{key_str}]: {value}")
                    } else if key_str == value {
                        key_str
                    } else {
                        format!("{key_str}: {value}")
                    }
                }
                ObjectPatternProperty::Spread(s) => {
                    format!("...{}", self.codegen_lvalue_place(&s.place))
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!("{{ {parts} }}")
    }

    fn codegen_place_to_expression(&mut self, place: &Place) -> String {
        temp_to_expr(&self.codegen_place(place))
    }

    /// Render a member/computed-load *object* place. When the object resolves to an
    /// optional chain (`Temp::OptionalChain`) and we are NOT inside an enclosing
    /// optional-chain rebuild (`optional_depth == 0`), the access is a plain
    /// (non-optional) member that *terminates* the chain — `(a?.b).c` — so the
    /// chain must be parenthesized, mirroring babel-generator wrapping an
    /// `OptionalMemberExpression` that is the object of a plain `MemberExpression`.
    /// Inside a chain rebuild (`optional_depth > 0`) the member extends the chain
    /// (`a?.b.c`) and is left unparenthesized.
    fn codegen_member_object(&mut self, place: &Place) -> String {
        match self.codegen_place(place) {
            Temp::OptionalChain(s) if self.optional_depth == 0 => format!("({s})"),
            other => temp_to_expr(&other),
        }
    }

    fn codegen_place(&mut self, place: &Place) -> Temp {
        if let Some(Some(tmp)) = self.temp.get(&place.identifier.declaration_id) {
            return tmp.clone();
        }
        Temp::Expr(convert_identifier(&place.identifier))
    }
}

/// A target for a store/declare/destructure: a single place or a pattern.
enum LvalueTarget {
    Place(Place),
    Pattern(Pattern),
}

/// The output of [`Emitter::codegen_terminal`]: a single statement, or a bare
/// block (only the `Label` terminal) whose statements are tracked individually so
/// the labeled-statement unwrap can detect a single-statement block exactly.
enum TermResult {
    Stmt(String),
    Block(Vec<String>),
}

// --- free helpers ----------------------------------------------------------

/// Emit an expression as an expression statement, parenthesizing it when its
/// leading token would otherwise make the parser read a statement (a leading
/// `{` is parsed as a block, a leading `function`/`class` as a declaration).
///
/// This mirrors babel-generator's auto-parenthesization: an
/// `AssignmentExpression` whose left side is an object pattern
/// (`({a, ...rest} = obj)`) or a bare object-literal/`function`/`class`
/// expression statement gets wrapped in parens. Without this, a destructured
/// object-pattern reassignment emits `{a, ...rest} = obj;`, which JS parses as a
/// block statement (a syntax error that drops the whole function to empty under
/// canonical comparison).
fn emit_expression_statement(expr: &str) -> String {
    let trimmed = expr.trim_start();
    let needs_parens = trimmed.starts_with('{')
        || trimmed.starts_with("function")
        || trimmed.starts_with("class")
        || trimmed.starts_with("async function");
    if needs_parens {
        format!("({expr});")
    } else {
        format!("{expr};")
    }
}

fn temp_to_expr(value: &Temp) -> String {
    match value {
        Temp::Expr(e) => e.clone(),
        Temp::JsxText(t) => format!("\"{t}\""),
        Temp::Member { object, property, computed } => {
            let object = wrap_member_object(object);
            if *computed {
                format!("{object}[{property}]")
            } else {
                format!("{object}.{property}")
            }
        }
        Temp::Call { callee, args } => format!("{callee}({args})"),
        Temp::OptionalChain(s) => s.clone(),
    }
}

/// Parenthesize a member/call object expression when it is a top-level TS type
/// cast (`x as T` / `x satisfies T`). The member/call operator binds tighter than
/// `as`/`satisfies`, so `(x as T).a` must keep its parens — otherwise the cast
/// would re-parse as `x as (T.a)`. Mirrors babel-generator wrapping a
/// `TSAsExpression`/`TSSatisfiesExpression` that appears as a member object.
fn wrap_member_object(object: &str) -> String {
    if has_top_level_cast(object) {
        format!("({object})")
    } else {
        object.to_string()
    }
}

/// `createHookGuard` (`CodegenReactiveFunction.ts:1352-1370`): wrap the body
/// statements in a `try { <fn>(0); <stmts> } finally { <fn>(1); }` guard. Used to
/// wrap the whole function body under `enableEmitHookGuards`.
fn wrap_hook_guard_try(guard_fn: &str, stmts: Vec<String>) -> String {
    let inner = stmts.join("\n");
    format!("try {{\n{guard_fn}(0);\n{inner}\n}} finally {{\n{guard_fn}(1);\n}}")
}

/// Parenthesize a call/new *callee* that is a function/arrow/class expression,
/// matching the IIFE form the oracle ref reflects. The oracle `## Code` snapshots
/// are prettier-formatted, and prettier wraps the callee of a `CallExpression`/
/// `NewExpression` in parens when it is an `(Async)FunctionExpression` or
/// `ArrowFunctionExpression` (`(function (){})()`, `(() => x)()`), so the canonical
/// comparison (re-parse + print via oxc, which round-trips those explicit parens)
/// only matches if the Rust callee is wrapped the same way. This is not merely
/// cosmetic for the arrow case: an unparenthesized arrow callee `() => x()` parses
/// as `() => (x())` — the call binds *inside* the arrow body rather than invoking
/// the arrow — a genuine semantic miscompile.
fn wrap_callee(callee: &str) -> String {
    if callee_is_function_like(callee) {
        format!("({callee})")
    } else {
        callee.to_string()
    }
}

/// Whether an already-rendered expression `s` is, at its top level, a function
/// expression (`function …`/`async function …`/`function* …`), a class expression
/// (`class …`), or an arrow function (`(params) => …`). These are the callee forms
/// prettier parenthesizes in call/new position. An arrow is detected by a top-level
/// (depth-0, outside strings/templates) `=>`: an arrow has looser precedence than
/// any postfix call, so a `=>` that surfaces at depth 0 means the *whole* string is
/// an arrow (an already-parenthesized `(() => x)` keeps its `=>` at depth > 0 and is
/// not re-wrapped).
fn callee_is_function_like(s: &str) -> bool {
    let trimmed = s.trim_start();
    if trimmed.starts_with("function")
        || trimmed.starts_with("async function")
        || trimmed.starts_with("class")
    {
        // Guard against an identifier that merely *starts* with the keyword
        // (`functionLike`, `classic`): the keyword must be followed by a
        // non-identifier char (space, `*`, `(`, or end).
        let after = trimmed
            .strip_prefix("async ")
            .unwrap_or(trimmed)
            .trim_start_matches(|c: char| c.is_ascii_alphabetic());
        if after
            .chars()
            .next()
            .is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '_' || c == '$'))
        {
            return true;
        }
    }
    has_top_level_arrow(s)
}

/// Whether `s` has a top-level (depth-0, outside string/template literals) `=>`,
/// i.e. the rendered expression is itself an arrow function.
fn has_top_level_arrow(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut depth: i32 = 0;
    let mut quote: Option<u8> = None;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' | b'\'' | b'`' => quote = Some(b),
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'=' if depth == 0 && bytes.get(i + 1).copied() == Some(b'>') => return true,
            _ => {}
        }
        i += 1;
    }
    false
}

/// `@babel/types isIdentifierName`: a non-empty ASCII identifier name (starts
/// with a letter/`_`/`$`, rest letters/digits/`_`/`$`). Unlike `isValidIdentifier`
/// this does **not** reject reserved words — they are valid object-property keys
/// (`{ class: 1 }`), which is the context this is used in. The curated fixtures
/// only feed ASCII keys, so the ASCII check is sufficient.
fn is_identifier_name(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// Whether `s` contains a top-level (depth-0, outside strings) ` as ` /
/// ` satisfies ` cast operator.
fn has_top_level_cast(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut depth: i32 = 0;
    let mut quote: Option<u8> = None;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' | b'\'' | b'`' => quote = Some(b),
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b' ' if depth == 0 => {
                let rest = &s[i + 1..];
                // A top-level ` as ` / ` satisfies ` operator: the keyword must be
                // delimited by a following space (so `assignment`/`satisfiesX` do
                // not match).
                if rest.starts_with("as ") || rest.starts_with("satisfies ") {
                    return true;
                }
            }
            _ => {}
        }
        i += 1;
    }
    false
}

/// Babel-`@babel/generator` operator precedence table (`parentheses.js`
/// `PRECEDENCE`). Higher number binds tighter. Used to decide whether a
/// rendered binary/logical operand needs parenthesizing inside a binary/logical
/// parent, matching babel's `BinaryLike` rule (`parentPos > nodePos`).
fn binary_operator_precedence(op: &str) -> Option<i32> {
    Some(match op {
        "||" => 0,
        "??" => 1,
        "&&" => 2,
        "|" => 3,
        "^" => 4,
        "&" => 5,
        "==" | "===" | "!=" | "!==" => 6,
        "<" | ">" | "<=" | ">=" | "in" | "instanceof" => 7,
        ">>" | "<<" | ">>>" => 8,
        "+" | "-" => 9,
        "*" | "/" | "%" => 10,
        "**" => 11,
        _ => return None,
    })
}

/// The lowest-precedence top-level construct of an already-rendered expression
/// string, used to mirror babel's needs-parens decisions without a real AST.
/// Anything tighter than a binary operator (member/call/unary/primary) is
/// `Primary` and never needs parens inside a binary/logical/conditional parent.
#[derive(Clone, Copy, PartialEq)]
enum ExprKind {
    /// A top-level comma (`a, b`) — a `SequenceExpression`.
    Sequence,
    /// A top-level assignment (`x = …`, `x += …`).
    Assignment,
    /// A top-level conditional (`a ? b : c`).
    Conditional,
    /// A top-level binary/logical operator with the given babel precedence.
    Binary(i32),
    /// Anything tighter (member, call, unary, primary, or already parenthesized).
    Primary,
}

/// Classify the lowest-precedence top-level operator of a rendered expression
/// `s` by scanning at brace/bracket/paren depth 0, outside string/template
/// literals. Mirrors the structural distinctions babel's `parentheses.js` keys
/// off (`SequenceExpression`/`AssignmentExpression`/`ConditionalExpression`/
/// `BinaryLike`). A fully-parenthesized expression scans as `Primary` (depth
/// never returns to 0 between the operands), so it is never double-wrapped.
fn classify_expr(s: &str) -> ExprKind {
    let bytes = s.as_bytes();
    let mut depth: i32 = 0;
    let mut quote: Option<u8> = None;
    let mut i = 0;
    // Track the lowest-precedence top-level construct seen. Comma < assignment <
    // conditional < binary(precedence). We keep the first/loosest.
    let mut found = ExprKind::Primary;
    // Whether we are positioned where a binary/unary operator could begin (i.e.
    // the previous non-space token closed an operand). Used to disambiguate
    // unary `+`/`-` from binary `+`/`-`.
    let mut after_operand = false;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                quote = None;
                after_operand = true;
            }
            i += 1;
            continue;
        }
        // A byte >= 0x80 is part of a multi-byte UTF-8 char (e.g. `▋` in JSX text
        // or a unicode identifier). None are JS operators/punctuation (all ASCII),
        // and slicing `&s[i..]` mid-char below would panic — so treat the char as
        // operand content and skip its bytes one at a time to the next boundary.
        if b >= 0x80 {
            after_operand = true;
            i += 1;
            continue;
        }
        match b {
            b'"' | b'\'' | b'`' => {
                quote = Some(b);
                i += 1;
                continue;
            }
            b'(' | b'[' | b'{' => {
                depth += 1;
                after_operand = false;
                i += 1;
                continue;
            }
            b')' | b']' | b'}' => {
                depth -= 1;
                after_operand = true;
                i += 1;
                continue;
            }
            _ => {}
        }
        if depth != 0 {
            i += 1;
            continue;
        }
        if b == b',' {
            return ExprKind::Sequence;
        }
        if b == b'?' {
            // `?.` optional chaining and `??` are not the conditional operator.
            let next = bytes.get(i + 1).copied();
            if next == Some(b'.') {
                i += 2;
                after_operand = true;
                continue;
            }
            if next == Some(b'?') {
                // `??` logical operator.
                found = lower_of(found, ExprKind::Binary(1));
                i += 2;
                after_operand = false;
                continue;
            }
            found = lower_of(found, ExprKind::Conditional);
            i += 1;
            after_operand = false;
            continue;
        }
        if b == b'=' {
            // `==`/`===` are binary equality; `=>` is an arrow; `<=`/`>=`/`!=`
            // are handled by their leading char. A lone `=` (or `+=` etc., whose
            // leading char we already saw) is assignment.
            let next = bytes.get(i + 1).copied();
            if next == Some(b'=') {
                found = lower_of(found, ExprKind::Binary(6));
                i += 2;
                after_operand = false;
                continue;
            }
            if next == Some(b'>') {
                // arrow: treat the whole thing as primary-ish (never wrapped as
                // an operand by our callers); skip past it.
                i += 2;
                after_operand = false;
                continue;
            }
            // Assignment (`=`); a preceding `+`/`-`/`*`/… compound op was already
            // scanned as a binary char, but assignment is looser, so record it.
            found = lower_of(found, ExprKind::Assignment);
            i += 1;
            after_operand = false;
            continue;
        }
        // Binary/logical operators (only meaningful between operands).
        if after_operand {
            let rest = &s[i..];
            // Multi-char operators first (`**` before `*`, `>>>` before `>>`).
            let multi: Option<(&str, i32)> = [
                ("===", 6),
                ("!==", 6),
                ("==", 6),
                ("!=", 6),
                ("<=", 7),
                (">=", 7),
                (">>>", 8),
                (">>", 8),
                ("<<", 8),
                ("&&", 2),
                ("||", 0),
                ("**", 11),
            ]
            .into_iter()
            .find(|(op, _)| rest.starts_with(op));
            if let Some((op, p)) = multi {
                found = lower_of(found, ExprKind::Binary(p));
                i += op.len();
                after_operand = false;
                continue;
            }
            // Single-char binary operators.
            if let Some(p) = match b {
                b'+' | b'-' => Some(9),
                b'*' | b'/' | b'%' => Some(10),
                b'<' | b'>' => Some(7),
                b'|' => Some(3),
                b'^' => Some(4),
                b'&' => Some(5),
                _ => None,
            } {
                found = lower_of(found, ExprKind::Binary(p));
                i += 1;
                after_operand = false;
                continue;
            }
        }
        if b == b' ' {
            let rest = &s[i + 1..];
            if after_operand && (rest.starts_with("in ") || rest.starts_with("instanceof ")) {
                found = lower_of(found, ExprKind::Binary(7));
            }
            i += 1;
            continue;
        }
        // Any other char advances an operand token.
        after_operand = true;
        i += 1;
    }
    found
}

/// Pick the looser (lower-precedence) of two classifications. Ordering:
/// `Sequence` < `Assignment` < `Conditional` < `Binary(p)` (by `p`) < `Primary`.
fn lower_of(a: ExprKind, b: ExprKind) -> ExprKind {
    fn rank(k: ExprKind) -> i32 {
        match k {
            ExprKind::Sequence => -3,
            ExprKind::Assignment => -2,
            ExprKind::Conditional => -1,
            ExprKind::Binary(p) => p,
            ExprKind::Primary => i32::MAX,
        }
    }
    if rank(a) <= rank(b) { a } else { b }
}

/// Parenthesize a rendered operand for placement inside a binary/logical parent
/// of precedence `parent_prec` (babel `parentheses.js` `BinaryLike` +
/// `ConditionalExpression`/`AssignmentExpression`/`SequenceExpression` rules).
/// `is_right` marks the operand as the parent's right child (for the
/// equal-precedence left-associativity rule). A looser operand (sequence,
/// assignment, conditional, or a binary of lower precedence — and an
/// equal-precedence binary on the right) is wrapped; a tighter operand is left
/// bare. This is what babel-generator does implicitly via the AST.
fn wrap_binary_operand(operand: &str, parent_prec: i32, is_right: bool) -> String {
    let needs = match classify_expr(operand) {
        ExprKind::Sequence | ExprKind::Assignment | ExprKind::Conditional => true,
        ExprKind::Binary(p) => p < parent_prec || (p == parent_prec && is_right),
        ExprKind::Primary => false,
    };
    if needs {
        format!("({operand})")
    } else {
        operand.to_string()
    }
}

/// Parenthesize a rendered operand for placement where a conditional/assignment/
/// sequence would need grouping but a binary would not — i.e. the test/branch of
/// a `ConditionalExpression` and the operand of a unary. Babel wraps a
/// `ConditionalExpression`/`AssignmentExpression`/`SequenceExpression` here; a
/// binary/primary is left bare.
fn wrap_cond_or_looser(operand: &str) -> String {
    match classify_expr(operand) {
        ExprKind::Sequence | ExprKind::Assignment | ExprKind::Conditional => {
            format!("({operand})")
        }
        _ => operand.to_string(),
    }
}

fn convert_identifier(identifier: &Identifier) -> String {
    match &identifier.name {
        Some(IdentifierName::Named { value }) => value.clone(),
        Some(IdentifierName::Promoted { value }) => value.clone(),
        None => String::new(),
    }
}

fn identifier_name(identifier: &Identifier) -> String {
    convert_identifier(identifier)
}

/// `compareScopeDependency`: order dependencies by their qualified name
/// (`base.prop?.next…`), which fixes cache-slot assignment deterministically.
fn compare_dependency(
    a: &ReactiveScopeDependency,
    b: &ReactiveScopeDependency,
) -> std::cmp::Ordering {
    fn qualified(dep: &ReactiveScopeDependency) -> String {
        let mut parts = vec![convert_identifier(&dep.identifier)];
        for entry in &dep.path {
            let prop = match &entry.property {
                PropertyLiteral::String(s) => s.clone(),
                PropertyLiteral::Number(n) => format_number(*n),
            };
            parts.push(format!("{}{prop}", if entry.optional { "?" } else { "" }));
        }
        parts.join(".")
    }
    qualified(a).cmp(&qualified(b))
}

fn codegen_primitive(value: &PrimitiveValue) -> String {
    match value {
        PrimitiveValue::Number(n) => {
            if *n < 0.0 {
                format!("-{}", format_number(-n))
            } else {
                format_number(*n)
            }
        }
        PrimitiveValue::Boolean(b) => b.to_string(),
        PrimitiveValue::String(s) => format!("\"{}\"", escape_string(s)),
        PrimitiveValue::Null => "null".to_string(),
        PrimitiveValue::Undefined => "undefined".to_string(),
    }
}

/// Parse a `let <name>[ = <init>]` / `const <name>[ = <init>]` declaration
/// produced by [`Emitter::codegen_block`] (statement text, trailing `;` already
/// stripped) into `(name, optional_initializer, kind)`. Returns `None` for any
/// non-declaration. Only the for-init collapse uses this; the declarator names
/// there are simple identifiers (the loop variables), so a top-level `=` cleanly
/// splits the (single) declarator from its initializer.
fn parse_for_init_declaration(s: &str) -> Option<(String, Option<String>, &'static str)> {
    let (kind, rest) = if let Some(rest) = s.strip_prefix("let ") {
        ("let", rest)
    } else if let Some(rest) = s.strip_prefix("const ") {
        ("const", rest)
    } else {
        return None;
    };
    let rest = rest.trim();
    match split_top_level_assign(rest) {
        Some((name, init)) => Some((name.trim().to_string(), Some(init.trim().to_string()), kind)),
        None => Some((rest.to_string(), None, kind)),
    }
}

/// Parse a bare `<name> = <rhs>` assignment statement text into `(target, rhs)`.
/// Returns `None` if there is no top-level `=` (e.g. it's a declaration).
fn parse_for_init_assignment(s: &str) -> Option<(String, String)> {
    let (lhs, rhs) = split_top_level_assign(s)?;
    Some((lhs.trim().to_string(), rhs.trim().to_string()))
}

/// Split on the first top-level `=` that is a plain assignment (not part of
/// `==`, `===`, `!=`, `<=`, `>=`, `=>`, `+=`, etc.) and not nested inside
/// brackets/parens/braces. Returns `(lhs, rhs)` or `None`.
fn split_top_level_assign(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'=' if depth == 0 => {
                let prev = if i > 0 { bytes[i - 1] } else { 0 };
                let next = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
                // Reject compound/comparison operators and arrows.
                let is_plain = next != b'='
                    && prev != b'='
                    && prev != b'!'
                    && prev != b'<'
                    && prev != b'>'
                    && prev != b'+'
                    && prev != b'-'
                    && prev != b'*'
                    && prev != b'/'
                    && prev != b'%'
                    && prev != b'&'
                    && prev != b'|'
                    && prev != b'^';
                if is_plain {
                    return Some((&s[..i], &s[i + 1..]));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn format_number(n: f64) -> String {
    if n == n.trunc() && n.is_finite() && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn escape_string(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out
}

/// Escape every non-ASCII codepoint as a JS `\uXXXX` escape over its UTF-16 code
/// units (uppercase hex, zero-padded to 4 digits), mirroring babel-generator's
/// `jsesc` default for string literals (a codepoint > 0xFFFF emits a surrogate
/// pair, e.g. `😀`). ASCII (< 0x80) is left as-is. Used for the bare
/// fbt-operand JSX attribute path, whose oracle is babel-generator's raw output.
fn escape_non_ascii(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if (c as u32) < 0x80 {
            out.push(c);
        } else {
            let mut buf = [0u16; 2];
            for unit in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{unit:04X}"));
            }
        }
    }
    out
}

fn strip_string_quotes(s: &str) -> String {
    let bytes = s.as_bytes();
    if bytes.len() >= 2 && (bytes[0] == b'"' || bytes[0] == b'\'') {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn jsx_string_requires_container(s: &str) -> bool {
    s.chars().any(|c| {
        c == '"' || c == '\\' || (c as u32) <= 0x1F || (c as u32) == 0x7F || (c as u32) >= 0x80
    })
}

fn non_local_binding_name(binding: &crate::hir::value::NonLocalBinding) -> String {
    use crate::hir::value::NonLocalBinding as B;
    match binding {
        B::ImportDefault { name, .. }
        | B::ImportNamespace { name, .. }
        | B::ImportSpecifier { name, .. }
        | B::ModuleLocal { name }
        | B::Global { name } => name.clone(),
    }
}

fn is_shorthand(key: &ObjectPropertyKey, value: &str) -> bool {
    matches!(key, ObjectPropertyKey::Identifier { name } if name == value)
}

/// Re-compile a JSX-outlined component's flat source as a top-level Component.
///
/// `Program.ts` inserts the outlined function back into the module body and
/// re-queues it (`{kind: 'outlined', fnType: 'Component'}`); the queue then runs
/// the full pipeline on the inserted source, materializing the component's
/// internal reactive scopes. We mirror that by running the module `codegen` on
/// the flat outlined source. The inner `react/compiler-runtime` import the
/// re-compilation prepends is stripped: the *outer* module already emits a single
/// shared import (the caller bumps its own `cache_count` so the import is
/// present). If the re-compilation does not memoize (no cache), the flat source
/// is returned unchanged.
fn recompile_outlined_component(flat: &str, cache_import_name: &str) -> String {
    // The flat outlined source is always a `function <id>(...) {...}` declaration.
    let recompiled = super::codegen(flat, "outlined.jsx");
    let trimmed = recompiled.trim();
    // Drop the prepended runtime import line(s); the enclosing module emits the
    // shared import already.
    let body: String = trimmed
        .lines()
        .filter(|line| !line.trim_start().starts_with("import "))
        .collect::<Vec<_>>()
        .join("\n");
    let body = body.trim();
    if body.is_empty() {
        flat.to_string()
    } else if cache_import_name != DEFAULT_CACHE_IMPORT_NAME {
        // The inner recompile computes the import name from the flat source (which
        // does not carry the outer module's `_c` conflicts), so it always uses the
        // default `_c`. The enclosing module shares a single `programContext`, so
        // rewrite the inner cache calls to the outer module's chosen name.
        body.replace(
            &format!("{DEFAULT_CACHE_IMPORT_NAME}("),
            &format!("{cache_import_name}("),
        )
    } else {
        body.to_string()
    }
}

/// `function foo(...) {...}` value → a function declaration with the lvalue name.
fn rewrite_function_expression_to_declaration(name: &str, value: &str) -> String {
    // `value` is `function helper(x) {...}` or `function (x) {...}`; ensure the
    // declaration carries `name`.
    if let Some(rest) = value.strip_prefix("function ") {
        // Strip any existing name up to the first `(`.
        if let Some(paren) = rest.find('(') {
            return format!("function {name}{}", &rest[paren..]);
        }
    }
    if let Some(rest) = value.strip_prefix("function") {
        return format!("function {name}{rest}");
    }
    format!("const {name} = {value};")
}

fn pattern_operands(pattern: &Pattern) -> Vec<Place> {
    let mut out = Vec::new();
    collect_pattern_operands(pattern, &mut out);
    out
}

fn collect_pattern_operands(pattern: &Pattern, out: &mut Vec<Place>) {
    match pattern {
        Pattern::Array(arr) => {
            for item in &arr.items {
                match item {
                    ArrayPatternItem::Place(p) => out.push(p.clone()),
                    ArrayPatternItem::Spread(SpreadPattern { place }) => out.push(place.clone()),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(obj) => {
            for prop in &obj.properties {
                match prop {
                    ObjectPatternProperty::Property(p) => out.push(p.place.clone()),
                    ObjectPatternProperty::Spread(SpreadPattern { place }) => {
                        out.push(place.clone())
                    }
                }
            }
        }
    }
}

