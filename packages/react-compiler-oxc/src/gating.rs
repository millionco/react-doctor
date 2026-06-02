//! The `@gating` / dynamic-gating conditional-compilation transform
//! (`Entrypoint/Gating.ts` + the `applyCompiledFunctions` gating branch in
//! `Entrypoint/Program.ts`).
//!
//! When the compiler is configured with a gating [`ExternalFunction`], each
//! successfully-compiled top-level function is not spliced in directly; instead it
//! is wrapped in a runtime selector that picks between the COMPILED and the
//! ORIGINAL implementation by calling the gating function. Two shapes
//! (`insertGatedFunctionDeclaration`, Gating.ts:127-195):
//!
//! - **Path 1** (`insertAdditionalFunctionDeclaration`, Gating.ts:36-126): a
//!   `FunctionDeclaration` referenced before its declaration at the top level. The
//!   wrapper must remain a hoistable `function Foo(arg0) { … }` so other top-level
//!   code that references `Foo` before its line still works. Emits a gating-call
//!   `const`, the optimized + unoptimized function declarations, and the wrapper.
//! - **Path 2** (Gating.ts:152-194): every other case. Emits a
//!   `ConditionalExpression` `<gating>() ? <compiled> : <original>` — replacing the
//!   function node in place (arrow / function expression), the whole declaration
//!   with `const Name = …` (FunctionDeclaration), or the `export default function`
//!   with a `const Name = …; export default Name;` pair.
//!
//! This Rust port works at the SOURCE-TEXT splice level (matching the rest of
//! Stage 7's codegen): the compiled function text comes from the emitter, the
//! original branch is the verbatim source, and the canonical comparison
//! (`codegen::canonicalize`, parse+reprint through oxc) makes the textual wrapper
//! equivalent to the AST babel builds.

use std::collections::HashSet;

use crate::compile::{ExternalFunction, GatingForm, GatingInfo};

/// Per-module gating bookkeeping: the gating-function import-local name (resolved
/// once via `newUid`) and a record of the collision-free names already taken.
/// Mirrors `ProgramContext`'s `addImportSpecifier` / `newUid` state for the gating
/// import (`Imports.ts:117-190`).
pub struct GatingState {
    /// The gating [`ExternalFunction`] (its `source` + `importSpecifierName`).
    pub function: ExternalFunction,
    /// The local name the gating function is imported under (`newUid` of
    /// `importSpecifierName`).
    pub import_local_name: String,
}

impl GatingState {
    /// Resolve the gating import-local name with `newUid`
    /// (`Imports.ts::addImportSpecifier` -> `newUid(importSpecifierName)`).
    ///
    /// `taken` is the set of every identifier name already bound/referenced in the
    /// program (the conservative `hasReference` analog), to which the `_c` cache
    /// name is added. For the gating import name `isForgetEnabled_Fixtures` (not a
    /// hook name): keep it as-is unless it is already taken, else
    /// `scope.generateUid(name)` → `_<name>` (then `_<name>2`, …).
    pub fn new(function: ExternalFunction, taken: &HashSet<String>) -> Self {
        let import_local_name = new_uid(&function.import_specifier_name, taken);
        GatingState {
            function,
            import_local_name,
        }
    }

    /// The gating import declaration line:
    /// `import { <imported>[ as <local>] } from "<source>";`.
    pub fn import_line(&self) -> String {
        if self.import_local_name == self.function.import_specifier_name {
            format!(
                "import {{ {} }} from \"{}\";",
                self.function.import_specifier_name, self.function.source
            )
        } else {
            format!(
                "import {{ {} as {} }} from \"{}\";",
                self.function.import_specifier_name, self.import_local_name, self.function.source
            )
        }
    }
}

/// `Imports.ts::newUid` (`117-142`) for a NON-hook name (the gating import names in
/// the fixtures — `isForgetEnabled_Fixtures`, `getTrue`, … — are never hook-named):
/// return `name` if it is not already taken, else `scope.generateUid(name)`, which
/// strips no prefix for a plain identifier and tries `_<name>`, `_<name>2`, … until
/// free. (Babel's `generateUid` prefixes `_` and uniquifies with a numeric suffix.)
pub fn new_uid(name: &str, taken: &HashSet<String>) -> String {
    if crate::environment::is_hook_name(name) {
        // Hook-named gating identifiers keep their name, uniquified with `_<i>`.
        if !taken.contains(name) {
            return name.to_string();
        }
        let mut i = 0;
        loop {
            let candidate = format!("{name}_{i}");
            if !taken.contains(&candidate) {
                return candidate;
            }
            i += 1;
        }
    }
    if !taken.contains(name) {
        return name.to_string();
    }
    // `scope.generateUid(name)`: candidates `_<name>`, `_<name>2`, `_<name>3`, …
    let base = format!("_{name}");
    if !taken.contains(&base) {
        return base;
    }
    let mut counter = 2u32;
    loop {
        let candidate = format!("_{name}{counter}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

/// The result of gating one compiled function: the replacement text and the byte
/// span it is spliced over.
pub struct GatingEdit {
    /// `[start, end)` byte span of the original node/statement being replaced.
    pub span: (u32, u32),
    /// The replacement source text.
    pub text: String,
}

/// Build the gating wrapper for one compiled function, given its compiled text
/// (`compiled` — the emitter's output for the function: `function Name(…) {…}` for
/// a declaration, `(…) => {…}` for an arrow) and the function-node span the
/// emitter would otherwise splice over.
///
/// `extra_uids` is the per-function collision set used to allocate the Path 1
/// `*_result` / `*_optimized` / `*_unoptimized` names (the program-wide `taken`
/// set ∪ the gating import name); each allocated name is inserted so the three do
/// not collide with each other.
pub fn build_gating_edit(
    info: &GatingInfo,
    state: &GatingState,
    compiled: &str,
    node_span: (u32, u32),
    taken: &HashSet<String>,
) -> GatingEdit {
    let call = format!("{}()", state.import_local_name);
    match &info.form {
        GatingForm::ExpressionInPlace => {
            // `fnPath.replaceWith(gatingExpression)` (Gating.ts:191-192): replace
            // the function node in place. `buildFunctionExpression` keeps an
            // (arrow)function expression as-is, so the compiled text and the
            // verbatim original are both valid expressions here.
            GatingEdit {
                span: node_span,
                text: conditional(&call, compiled, &info.original_source),
            }
        }
        GatingForm::FunctionDeclarationToConst {
            name,
            exported,
            statement_span,
        } => {
            // `const <name> = <gating>() ? <compiled> : <original>;`
            // (Gating.ts:165-174). A named `export function` keeps its `export`.
            let prefix = if *exported { "export const" } else { "const" };
            let text = format!(
                "{prefix} {name} = {};",
                conditional(&call, compiled, &info.original_source)
            );
            GatingEdit {
                span: *statement_span,
                text,
            }
        }
        GatingForm::ExportDefaultFunctionDeclaration {
            name,
            statement_span,
        } => {
            // `export default const` is illegal, so emit a named const + re-export
            // (Gating.ts:175-190).
            let text = format!(
                "const {name} = {};\nexport default {name};",
                conditional(&call, compiled, &info.original_source)
            );
            GatingEdit {
                span: *statement_span,
                text,
            }
        }
        GatingForm::FunctionDeclarationReferencedBefore {
            name,
            param_is_rest,
        } => {
            // `insertAdditionalFunctionDeclaration` (Gating.ts:36-126): hoistable
            // wrapper form.
            let mut local_taken = taken.clone();
            local_taken.insert(state.import_local_name.clone());
            let result_name = new_uid(&format!("{}_result", state.import_local_name), &local_taken);
            local_taken.insert(result_name.clone());
            let unoptimized_name = new_uid(&format!("{name}_unoptimized"), &local_taken);
            local_taken.insert(unoptimized_name.clone());
            let optimized_name = new_uid(&format!("{name}_optimized"), &local_taken);

            // Build the `arg0, arg1, …argN` forwarding params + spread args.
            let mut params = Vec::with_capacity(param_is_rest.len());
            let mut args = Vec::with_capacity(param_is_rest.len());
            for (i, is_rest) in param_is_rest.iter().enumerate() {
                let arg = format!("arg{i}");
                if *is_rest {
                    params.push(format!("...{arg}"));
                    args.push(format!("...{arg}"));
                } else {
                    params.push(arg.clone());
                    args.push(arg);
                }
            }
            let params = params.join(", ");
            let args = args.join(", ");

            // Rename the optimized function's id (`function <name>(` ->
            // `function <optimized>(`) and the unoptimized (original) function's id.
            let optimized_fn = rename_function_id(compiled, name, &optimized_name);
            let unoptimized_fn = rename_function_id(&info.original_source, name, &unoptimized_name);

            let text = format!(
                "const {result_name} = {call};\n\
                 {optimized_fn}\n\
                 {unoptimized_fn}\n\
                 function {name}({params}) {{\n\
                 if ({result_name}) return {optimized_name}({args});\n\
                 else return {unoptimized_name}({args});\n\
                 }}"
            );
            GatingEdit {
                span: node_span,
                text,
            }
        }
    }
}

/// `<call> ? <consequent> : <alternate>` — the gating conditional expression
/// (`t.conditionalExpression(...)`, Gating.ts:153-157). Wrapped on its own lines so
/// the spliced text re-parses cleanly.
fn conditional(call: &str, consequent: &str, alternate: &str) -> String {
    format!("{call} ? {consequent} : {alternate}")
}

/// Rename the leading `function <old>(` (optionally `async function`) id to
/// `<new>`, used for the Path 1 optimized/unoptimized declarations. Only the
/// function's OWN id (the first identifier after the `function` keyword) is
/// renamed; recursive self-references inside the body are intentionally left
/// pointing at the wrapper name, matching `compiled.id.name = …` /
/// `fnPath.get('id').replaceInline(…)`, which mutate only the binding id.
fn rename_function_id(source: &str, old: &str, new: &str) -> String {
    // Find `function` keyword, skip whitespace + an optional `*`, then the id.
    let Some(kw) = find_function_keyword(source) else {
        return source.to_string();
    };
    let after_kw = kw + "function".len();
    let rest = &source[after_kw..];
    let trimmed_len = rest.len() - rest.trim_start().len();
    let id_start = after_kw + trimmed_len;
    // The id runs until a non-identifier char (`(` or whitespace).
    let id_end = source[id_start..]
        .find(|c: char| !is_ident_char(c))
        .map(|i| id_start + i)
        .unwrap_or(source.len());
    if &source[id_start..id_end] != old {
        return source.to_string();
    }
    let mut out = String::with_capacity(source.len() + new.len());
    out.push_str(&source[..id_start]);
    out.push_str(new);
    out.push_str(&source[id_end..]);
    out
}

/// Find the byte index of the top-level `function` keyword that begins the
/// function header (skipping a leading `async ` modifier). Returns the index of
/// the `f` in `function`.
fn find_function_keyword(source: &str) -> Option<usize> {
    let trimmed = source.trim_start();
    let offset = source.len() - trimmed.len();
    let after_async = trimmed.strip_prefix("async").map(|r| {
        // skip the whitespace after `async`
        let ws = r.len() - r.trim_start().len();
        offset + "async".len() + ws
    });
    let base = after_async.unwrap_or(offset);
    if source[base..].trim_start().starts_with("function") {
        let ws = source[base..].len() - source[base..].trim_start().len();
        Some(base + ws)
    } else {
        None
    }
}

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}
