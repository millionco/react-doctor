//! `validateUseMemo` (`Validation/ValidateUseMemo.ts`): validates `useMemo()`
//! callbacks against common mistakes (`UseMemo` category) and that the result is a
//! used, non-void value (`VoidUseMemo` category).
//!
//! Runs on the raw post-lowering HIR, BEFORE `dropManualMemoization` rewrites the
//! `useMemo` calls away — so the lint driver invokes it on the freshly lowered
//! function rather than at the shared `InferMutationAliasingRanges` stage.

use std::collections::{HashMap, HashSet};

use crate::diagnostic::{BabelSourceLocation, Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::IdentifierId;
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::SourceLocation;
use crate::hir::terminal::{ReturnVariant, Terminal};
use crate::hir::value::{CallArgument, InstructionValue, LoweredFunction, NonLocalBinding, PropertyLiteral};

use super::cfg::{each_instruction_value_operand, each_terminal_operand};

const PARAMS_REASON: &str = "useMemo() callbacks may not accept parameters";
const PARAMS_DESCRIPTION: &str = "useMemo() callbacks are called by React to cache calculations across re-renders. They should not take parameters. Instead, directly reference the props, state, or local variables needed for the computation";
const PARAMS_DETAIL: &str = "Callbacks with parameters are not supported";

const ASYNC_REASON: &str = "useMemo() callbacks may not be async or generator functions";
const ASYNC_DESCRIPTION: &str = "useMemo() callbacks are called once and must synchronously return a value";
const ASYNC_DETAIL: &str = "Async and generator functions are not supported";

const REASSIGN_REASON: &str =
    "useMemo() callbacks may not reassign variables declared outside of the callback";
const REASSIGN_DESCRIPTION: &str = "useMemo() callbacks must be pure functions and cannot reassign variables defined outside of the callback function";
const REASSIGN_DETAIL: &str = "Cannot reassign variable";

const VOID_REASON: &str = "useMemo() callbacks must return a value";
const VOID_DESCRIPTION: &str = "This useMemo() callback doesn't return a value. useMemo() is for computing and caching values, not for arbitrary side effects";

const UNUSED_REASON: &str = "useMemo() result is unused";
const UNUSED_DESCRIPTION: &str = "This useMemo() value is unused. useMemo() is for computing and caching values, not for arbitrary side effects";

fn binding_name(binding: &NonLocalBinding) -> &str {
    match binding {
        NonLocalBinding::ImportDefault { name, .. }
        | NonLocalBinding::ImportNamespace { name, .. }
        | NonLocalBinding::ImportSpecifier { name, .. }
        | NonLocalBinding::ModuleLocal { name }
        | NonLocalBinding::Global { name } => name,
    }
}

fn param_loc(param: &FunctionParam) -> &SourceLocation {
    match param {
        FunctionParam::Place(place) => &place.loc,
        FunctionParam::Spread(spread) => &spread.place.loc,
    }
}

/// Whether the function has an explicit/implicit `return <value>` (a non-void
/// return). Mirrors `hasNonVoidReturn`.
fn has_non_void_return(func: &HirFunction) -> bool {
    func.body.blocks().iter().any(|block| {
        matches!(
            block.terminal,
            Terminal::Return { return_variant: ReturnVariant::Explicit | ReturnVariant::Implicit, .. }
        )
    })
}

pub fn validate_use_memo(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    let mut use_memos: HashSet<IdentifierId> = HashSet::new();
    let mut react: HashSet<IdentifierId> = HashSet::new();
    let mut functions: HashMap<IdentifierId, &LoweredFunction> = HashMap::new();
    // useMemo result id -> the callee location to blame if it stays unused.
    let mut unused_use_memos: HashMap<IdentifierId, Option<BabelSourceLocation>> = HashMap::new();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            if !unused_use_memos.is_empty() {
                for operand in each_instruction_value_operand(&instr.value) {
                    unused_use_memos.remove(&operand.identifier.id);
                }
            }
            match &instr.value {
                InstructionValue::LoadGlobal { binding, .. } => match binding_name(binding) {
                    "useMemo" => {
                        use_memos.insert(instr.lvalue.identifier.id);
                    }
                    "React" => {
                        react.insert(instr.lvalue.identifier.id);
                    }
                    _ => {}
                },
                InstructionValue::PropertyLoad { object, property, .. } => {
                    if react.contains(&object.identifier.id)
                        && matches!(property, PropertyLiteral::String(name) if name == "useMemo")
                    {
                        use_memos.insert(instr.lvalue.identifier.id);
                    }
                }
                InstructionValue::FunctionExpression { lowered_func, .. } => {
                    functions.insert(instr.lvalue.identifier.id, lowered_func.as_ref());
                }
                InstructionValue::CallExpression { callee, args, .. }
                | InstructionValue::MethodCall { property: callee, args, .. } => {
                    if !use_memos.contains(&callee.identifier.id) || args.is_empty() {
                        continue;
                    }
                    let arg = match args.first() {
                        Some(CallArgument::Place(place)) => place,
                        _ => continue,
                    };
                    let Some(body) = functions.get(&arg.identifier.id).copied() else {
                        continue;
                    };
                    validate_callback(body, resolver, diagnostics);
                    if has_non_void_return(&body.func) {
                        unused_use_memos
                            .insert(instr.lvalue.identifier.id, resolver.resolve(&callee.loc));
                    } else {
                        diagnostics.push(
                            Diagnostic::create(ErrorCategory::VoidUseMemo, VOID_REASON)
                                .with_description(VOID_DESCRIPTION)
                                .with_error_detail(
                                    resolver.resolve(&body.func.loc),
                                    Some(VOID_REASON.to_string()),
                                ),
                        );
                    }
                }
                _ => {}
            }
        }
        if !unused_use_memos.is_empty() {
            for operand in each_terminal_operand(&block.terminal) {
                unused_use_memos.remove(&operand.identifier.id);
            }
        }
    }

    for loc in unused_use_memos.into_values() {
        diagnostics.push(
            Diagnostic::create(ErrorCategory::VoidUseMemo, UNUSED_REASON)
                .with_description(UNUSED_DESCRIPTION)
                .with_error_detail(loc, Some(UNUSED_REASON.to_string())),
        );
    }
}

/// The `UseMemo`-category checks on a `useMemo` callback body: no parameters, not
/// async/generator, and no reassignment of outer (context) variables.
fn validate_callback(
    body: &LoweredFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    if let Some(first_param) = body.func.params.first() {
        diagnostics.push(
            Diagnostic::create(ErrorCategory::UseMemo, PARAMS_REASON)
                .with_description(PARAMS_DESCRIPTION)
                .with_error_detail(
                    resolver.resolve(param_loc(first_param)),
                    Some(PARAMS_DETAIL.to_string()),
                ),
        );
    }

    if body.func.async_ || body.func.generator {
        diagnostics.push(
            Diagnostic::create(ErrorCategory::UseMemo, ASYNC_REASON)
                .with_description(ASYNC_DESCRIPTION)
                .with_error_detail(
                    resolver.resolve(&body.func.loc),
                    Some(ASYNC_DETAIL.to_string()),
                ),
        );
    }

    validate_no_context_variable_assignment(&body.func, resolver, diagnostics);
}

/// `validateNoContextVariableAssignment`: a `StoreContext` whose target is one of
/// the callback's captured (context) variables is an outer-variable reassignment.
fn validate_no_context_variable_assignment(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    let context: HashSet<IdentifierId> =
        func.context.iter().map(|place| place.identifier.id).collect();
    for block in func.body.blocks() {
        for instr in &block.instructions {
            if let InstructionValue::StoreContext { place, .. } = &instr.value {
                if context.contains(&place.identifier.id) {
                    diagnostics.push(
                        Diagnostic::create(ErrorCategory::UseMemo, REASSIGN_REASON)
                            .with_description(REASSIGN_DESCRIPTION)
                            .with_error_detail(
                                resolver.resolve(&place.loc),
                                Some(REASSIGN_DETAIL.to_string()),
                            ),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn count(code: &str, category: ErrorCategory) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == category)
            .count()
    }

    const IMPORTS: &str = "import { useMemo } from \"react\";\n";

    #[test]
    fn flags_use_memo_callback_with_params() {
        let code = "function Component(props) {\n  const value = useMemo((x) => x + 1, [props.a]);\n  return <div>{value}</div>;\n}\n";
        assert_eq!(count(&format!("{IMPORTS}{code}"), ErrorCategory::UseMemo), 1);
    }

    #[test]
    fn flags_void_use_memo() {
        let code = "function Component(props) {\n  useMemo(() => {\n    doSomething(props.a);\n  }, [props.a]);\n  return null;\n}\n";
        assert_eq!(count(&format!("{IMPORTS}{code}"), ErrorCategory::VoidUseMemo), 1);
    }

    #[test]
    fn allows_well_formed_use_memo() {
        let code = "function Component(props) {\n  const value = useMemo(() => props.a + 1, [props.a]);\n  return <div>{value}</div>;\n}\n";
        assert_eq!(count(&format!("{IMPORTS}{code}"), ErrorCategory::UseMemo), 0);
        assert_eq!(count(&format!("{IMPORTS}{code}"), ErrorCategory::VoidUseMemo), 0);
    }
}
