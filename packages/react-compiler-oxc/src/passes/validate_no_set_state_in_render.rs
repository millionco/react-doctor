//! `validateNoSetStateInRender` (`Validation/ValidateNoSetStateInRender.ts`):
//! flags an unconditional `setState` call during render (a likely infinite render
//! loop), including the indirect case where `setState` is wrapped in a local
//! function that is then called unconditionally, and the `setState`-inside-
//! `useMemo` case.
//!
//! Unlike `passes::validate_hooks_usage` (which collapses to a single boolean for
//! the codegen-bailout decision), this port emits located [`Diagnostic`]s for the
//! lint surface, mirroring the TS `pushDiagnostic` calls one-for-one.

use std::collections::HashSet;

use crate::diagnostic::{Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::IdentifierId;
use crate::hir::model::HirFunction;
use crate::hir::type_checks::is_set_state_type;
use crate::hir::value::InstructionValue;

use super::cfg::each_instruction_value_operand;
use super::control_dominators::compute_unconditional_blocks;

const USE_MEMO_REASON: &str = "Calling setState from useMemo may trigger an infinite loop";
const USE_MEMO_DESCRIPTION: &str = "Each time the memo callback is evaluated it will change state. This can cause a memoization dependency to change, running the memo function again and causing an infinite loop. Instead of setting state in useMemo(), prefer deriving the value during render. (https://react.dev/reference/react/useState)";
const USE_MEMO_DETAIL: &str = "Found setState() within useMemo()";

const RENDER_REASON: &str = "Cannot call setState during render";
const RENDER_DETAIL: &str = "Found setState() in render";
const RENDER_DESCRIPTION: &str = "Calling setState during render may trigger an infinite loop.\n* To reset state when other state/props change, store the previous value in state and update conditionally: https://react.dev/reference/react/useState#storing-information-from-previous-renders\n* To derive data from other state/props, compute the derived data during render without using state";
const RENDER_DESCRIPTION_KEYED: &str = "Calling setState during render may trigger an infinite loop.\n* To reset state when other state/props change, use `const [state, setState] = useKeyedState(initialState, key)` to reset `state` when `key` changes.\n* To derive data from other state/props, compute the derived data during render without using state";

/// `validateNoSetStateInRender(fn)`: collect every set-state-in-render diagnostic
/// for `func` (and its nested function expressions). `enable_use_keyed_state`
/// mirrors `env.config.enableUseKeyedState` and only changes the render-case
/// description.
pub fn validate_no_set_state_in_render(
    func: &HirFunction,
    resolver: &PositionResolver,
    enable_use_keyed_state: bool,
    diagnostics: &mut Diagnostics,
) {
    let mut unconditional_set_state_functions: HashSet<IdentifierId> = HashSet::new();
    let collected = validate_impl(
        func,
        resolver,
        enable_use_keyed_state,
        &mut unconditional_set_state_functions,
    );
    for diagnostic in collected.into_vec() {
        diagnostics.push(diagnostic);
    }
}

/// `validateNoSetStateInRenderImpl(fn, unconditionalSetStateFunctions)`: returns
/// the diagnostics found in `func`, threading the set of identifier ids that
/// resolve (directly or via a wrapper function) to an unconditional `setState`.
fn validate_impl(
    func: &HirFunction,
    resolver: &PositionResolver,
    enable_use_keyed_state: bool,
    unconditional_set_state_functions: &mut HashSet<IdentifierId>,
) -> Diagnostics {
    let unconditional_blocks = compute_unconditional_blocks(func);
    let mut active_manual_memo = false;
    let mut errors = Diagnostics::new();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadLocal { place, .. } => {
                    if unconditional_set_state_functions.contains(&place.identifier.id) {
                        unconditional_set_state_functions.insert(instr.lvalue.identifier.id);
                    }
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    if unconditional_set_state_functions.contains(&value.identifier.id) {
                        unconditional_set_state_functions.insert(lvalue.place.identifier.id);
                        unconditional_set_state_functions.insert(instr.lvalue.identifier.id);
                    }
                }
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    let references_set_state =
                        each_instruction_value_operand(&instr.value).iter().any(|operand| {
                            is_set_state_type(&operand.identifier)
                                || unconditional_set_state_functions
                                    .contains(&operand.identifier.id)
                        });
                    if references_set_state {
                        let nested = validate_impl(
                            &lowered_func.func,
                            resolver,
                            enable_use_keyed_state,
                            unconditional_set_state_functions,
                        );
                        if !nested.is_empty() {
                            unconditional_set_state_functions.insert(instr.lvalue.identifier.id);
                        }
                    }
                }
                InstructionValue::StartMemoize { .. } => {
                    active_manual_memo = true;
                }
                InstructionValue::FinishMemoize { .. } => {
                    active_manual_memo = false;
                }
                InstructionValue::CallExpression { callee, .. } => {
                    let is_set_state = is_set_state_type(&callee.identifier)
                        || unconditional_set_state_functions.contains(&callee.identifier.id);
                    if !is_set_state {
                        continue;
                    }
                    if active_manual_memo {
                        errors.push(
                            Diagnostic::create(ErrorCategory::RenderSetState, USE_MEMO_REASON)
                                .with_description(USE_MEMO_DESCRIPTION)
                                .with_error_detail(
                                    resolver.resolve(&callee.loc),
                                    Some(USE_MEMO_DETAIL.to_string()),
                                ),
                        );
                    } else if unconditional_blocks.contains(&block.id) {
                        let description = if enable_use_keyed_state {
                            RENDER_DESCRIPTION_KEYED
                        } else {
                            RENDER_DESCRIPTION
                        };
                        errors.push(
                            Diagnostic::create(ErrorCategory::RenderSetState, RENDER_REASON)
                                .with_description(description)
                                .with_error_detail(
                                    resolver.resolve(&callee.loc),
                                    Some(RENDER_DETAIL.to_string()),
                                ),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn render_set_state_count(code: &str) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == ErrorCategory::RenderSetState)
            .count()
    }

    #[test]
    fn flags_direct_set_state_in_render() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  setState(1);\n  return <div>{state}</div>;\n}\n";
        assert_eq!(render_set_state_count(code), 1);
    }

    #[test]
    fn flags_indirect_set_state_via_wrapper_called_in_render() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  const setTrue = () => setState(1);\n  setTrue();\n  return <div>{state}</div>;\n}\n";
        assert_eq!(render_set_state_count(code), 1);
    }

    #[test]
    fn ignores_conditional_set_state() {
        let code = "function Component(props) {\n  const [state, setState] = useState(0);\n  if (props.cond) {\n    setState(1);\n  }\n  return <div>{state}</div>;\n}\n";
        assert_eq!(render_set_state_count(code), 0);
    }

    #[test]
    fn ignores_set_state_in_event_handler() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  const onClick = () => setState(1);\n  return <div onClick={onClick}>{state}</div>;\n}\n";
        assert_eq!(render_set_state_count(code), 0);
    }

    #[test]
    fn reports_primary_location_at_the_call() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  setState(1);\n  return <div>{state}</div>;\n}\n";
        let diagnostics = lint(code, "Component.tsx");
        let diagnostic = diagnostics
            .iter()
            .find(|diagnostic| diagnostic.category == ErrorCategory::RenderSetState)
            .expect("expected a RenderSetState diagnostic");
        let loc = diagnostic.primary_location().expect("expected a primary location");
        // `setState(1)` is on line 3 (1-based).
        assert_eq!(loc.start.line, 3);
    }
}
