//! `validateNoSetStateInEffects` (`Validation/ValidateNoSetStateInEffects.ts`):
//! flags `setState` called synchronously in the body of an effect (`useEffect` /
//! `useLayoutEffect` / `useInsertionEffect`), which triggers cascading renders.
//! Calling `setState` in a callback *scheduled* by the effect is allowed.
//!
//! This ports the default-config behavior (`enableAllowSetStateFromRefsInEffects`
//! and `enableVerboseNoSetStateInEffect` both off): the ref-derived allowance and
//! the verbose message variant are not part of the recommended preset.

use std::collections::HashMap;

use crate::diagnostic::{Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::IdentifierId;
use crate::hir::model::HirFunction;
use crate::hir::place::Place;
use crate::hir::type_checks::{
    is_set_state_type, is_use_effect_event_type, is_use_effect_hook_type,
    is_use_insertion_effect_hook_type, is_use_layout_effect_hook_type,
};
use crate::hir::value::{CallArgument, InstructionValue};

use super::cfg::each_instruction_value_operand;

const REASON: &str =
    "Calling setState synchronously within an effect can trigger cascading renders";
const DETAIL: &str = "Avoid calling setState() directly within an effect";
const DESCRIPTION: &str = "Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:\n* Update external systems with the latest state from React.\n* Subscribe for updates from some external system, calling setState in a callback function when external state changes.\n\nCalling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect)";

/// The first positional argument of a call, if it is a plain identifier (not a
/// spread) — mirrors `arg.kind === 'Identifier'`.
fn first_identifier_arg(args: &[CallArgument]) -> Option<&Place> {
    match args.first() {
        Some(CallArgument::Place(place)) => Some(place),
        _ => None,
    }
}

pub fn validate_no_set_state_in_effects(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    let mut set_state_functions: HashMap<IdentifierId, Place> = HashMap::new();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadLocal { place, .. } => {
                    if set_state_functions.contains_key(&place.identifier.id) {
                        set_state_functions.insert(instr.lvalue.identifier.id, place.clone());
                    }
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    if set_state_functions.contains_key(&value.identifier.id) {
                        set_state_functions.insert(lvalue.place.identifier.id, value.clone());
                        set_state_functions.insert(instr.lvalue.identifier.id, value.clone());
                    }
                }
                InstructionValue::FunctionExpression { lowered_func, .. } => {
                    let references_set_state =
                        each_instruction_value_operand(&instr.value).iter().any(|operand| {
                            is_set_state_type(&operand.identifier)
                                || set_state_functions.contains_key(&operand.identifier.id)
                        });
                    if references_set_state {
                        if let Some(callee) =
                            get_set_state_call(&lowered_func.func, &mut set_state_functions)
                        {
                            set_state_functions.insert(instr.lvalue.identifier.id, callee);
                        }
                    }
                }
                InstructionValue::MethodCall { property, args, .. } => handle_effect_call(
                    property,
                    args,
                    &instr.lvalue,
                    &mut set_state_functions,
                    resolver,
                    diagnostics,
                ),
                InstructionValue::CallExpression { callee, args, .. } => handle_effect_call(
                    callee,
                    args,
                    &instr.lvalue,
                    &mut set_state_functions,
                    resolver,
                    diagnostics,
                ),
                _ => {}
            }
        }
    }
}

/// The `MethodCall`/`CallExpression` arm: `useEffectEvent` wrappers transitively
/// carry the tracked `setState`; the effect hooks report a diagnostic when their
/// first argument is a tracked `setState` function.
fn handle_effect_call(
    callee: &Place,
    args: &[CallArgument],
    lvalue: &Place,
    set_state_functions: &mut HashMap<IdentifierId, Place>,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    if is_use_effect_event_type(&callee.identifier) {
        if let Some(arg) = first_identifier_arg(args) {
            if let Some(set_state) = set_state_functions.get(&arg.identifier.id).cloned() {
                set_state_functions.insert(lvalue.identifier.id, set_state);
            }
        }
        return;
    }
    let is_effect_hook = is_use_effect_hook_type(&callee.identifier)
        || is_use_layout_effect_hook_type(&callee.identifier)
        || is_use_insertion_effect_hook_type(&callee.identifier);
    if !is_effect_hook {
        return;
    }
    if let Some(arg) = first_identifier_arg(args) {
        if let Some(set_state) = set_state_functions.get(&arg.identifier.id) {
            diagnostics.push(
                Diagnostic::create(ErrorCategory::EffectSetState, REASON)
                    .with_description(DESCRIPTION)
                    .with_error_detail(resolver.resolve(&set_state.loc), Some(DETAIL.to_string())),
            );
        }
    }
}

/// `getSetStateCall(fn, setStateFunctions)` (default config): returns the first
/// `setState` callee reached unconditionally in the effect body, tracking local
/// aliases through the shared `setStateFunctions` map.
fn get_set_state_call(
    func: &HirFunction,
    set_state_functions: &mut HashMap<IdentifierId, Place>,
) -> Option<Place> {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadLocal { place, .. } => {
                    if set_state_functions.contains_key(&place.identifier.id) {
                        set_state_functions.insert(instr.lvalue.identifier.id, place.clone());
                    }
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    if set_state_functions.contains_key(&value.identifier.id) {
                        set_state_functions.insert(lvalue.place.identifier.id, value.clone());
                        set_state_functions.insert(instr.lvalue.identifier.id, value.clone());
                    }
                }
                InstructionValue::CallExpression { callee, .. } => {
                    if is_set_state_type(&callee.identifier)
                        || set_state_functions.contains_key(&callee.identifier.id)
                    {
                        return Some(callee.clone());
                    }
                }
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn effect_set_state_count(code: &str) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == ErrorCategory::EffectSetState)
            .count()
    }

    const IMPORTS: &str = "import { useState, useEffect } from \"react\";\n";

    #[test]
    fn flags_set_state_in_effect_body() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  useEffect(() => {\n    setState(1);\n  });\n  return <div>{state}</div>;\n}\n";
        assert_eq!(effect_set_state_count(&format!("{IMPORTS}{code}")), 1);
    }

    #[test]
    fn ignores_set_state_in_scheduled_callback() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  useEffect(() => {\n    const id = setInterval(() => setState((c) => c + 1), 1000);\n    return () => clearInterval(id);\n  });\n  return <div>{state}</div>;\n}\n";
        assert_eq!(effect_set_state_count(&format!("{IMPORTS}{code}")), 0);
    }

    #[test]
    fn ignores_components_without_effects() {
        let code = "function Component() {\n  const [state, setState] = useState(0);\n  setState(1);\n  return <div>{state}</div>;\n}\n";
        assert_eq!(effect_set_state_count(&format!("{IMPORTS}{code}")), 0);
    }
}
