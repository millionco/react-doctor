//! `validateHooksUsage` (`Validation/ValidateHooksUsage.ts`): validates that the
//! function honors the [Rules of Hooks](https://react.dev/warnings/invalid-hook-call-warning),
//! specifically:
//!
//!  * **Known hooks** may only be called *unconditionally* and may not be used as
//!    first-class values (`recordConditionalHookError` / `recordInvalidHookUsageError`).
//!  * **Potential hooks** (hook-named locals) may be referenced as values but may
//!    not be the callee of a conditional call (`recordConditionalHookError`), and
//!    a conditional/dynamic potential-hook call is a `recordDynamicHookUsageError`.
//!  * Hooks may not be called inside nested function expressions
//!    (`visitFunctionExpression`).
//!
//! Unlike the TS, which accumulates the diagnostics onto `env` (and later decides
//! whether to throw based on `panicThreshold`), this port simply reports *whether*
//! any Rules-of-Hooks violation was found. The caller (`compile_one_reactive`)
//! mirrors the TS `processFn`/`handleError` recovery: when `@panicThreshold:"none"`
//! the offending function is left verbatim, exactly as the oracle emits it.

use std::collections::HashMap;

use crate::hir::ids::IdentifierId;
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::{IdentifierName, Place};
use crate::hir::value::InstructionValue;

use super::cfg::{
    each_instruction_value_lvalue, each_instruction_value_operand, each_terminal_operand,
};
use super::control_dominators::compute_unconditional_blocks;
use super::infer_reactive_places::get_hook_kind;

/// Whether a name is hook-like (`isHookName`: `/^use[A-Z0-9]/`).
use crate::environment::globals::is_hook_name;

/// `Kind`: the lattice of possible values a `Place` may hold during abstract
/// interpretation. Earlier variants take precedence in [`join_kinds`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    /// A potential/known hook already used in an invalid way.
    Error,
    /// A known hook (a `LoadGlobal` typed as a hook, or a property/destructure of one).
    KnownHook,
    /// A potential hook (a hook-named local, or a property/destructure of one).
    PotentialHook,
    /// A `LoadGlobal` not inferred as a hook.
    Global,
    /// All other values (local variables).
    Local,
}

/// `joinKinds(a, b)`: the lattice meet (earlier variants win).
fn join_kinds(a: Kind, b: Kind) -> Kind {
    if a == Kind::Error || b == Kind::Error {
        Kind::Error
    } else if a == Kind::KnownHook || b == Kind::KnownHook {
        Kind::KnownHook
    } else if a == Kind::PotentialHook || b == Kind::PotentialHook {
        Kind::PotentialHook
    } else if a == Kind::Global || b == Kind::Global {
        Kind::Global
    } else {
        Kind::Local
    }
}

fn place_name(place: &Place) -> Option<&str> {
    match &place.identifier.name {
        Some(IdentifierName::Named { value }) => Some(value.as_str()),
        // Promoted temporaries (`#t…`) are never hook-named source identifiers.
        Some(IdentifierName::Promoted { .. }) | None => None,
    }
}

/// State for the abstract interpretation, mirroring the closures captured by the
/// TS `validateHooksUsage`.
struct Validator {
    value_kinds: HashMap<IdentifierId, Kind>,
    /// Whether any Rules-of-Hooks violation was recorded. The TS records each
    /// diagnostic onto `env`; for the recoverable-bailout decision we only need to
    /// know whether *any* error occurred.
    has_error: bool,
}

impl Validator {
    /// `getKindForPlace(place)`: the known kind of a place, upgraded to at least
    /// `PotentialHook` when the place is hook-named.
    fn get_kind_for_place(&self, place: &Place) -> Kind {
        let known = self.value_kinds.get(&place.identifier.id).copied();
        if place_name(place).is_some_and(is_hook_name) {
            join_kinds(known.unwrap_or(Kind::Local), Kind::PotentialHook)
        } else {
            known.unwrap_or(Kind::Local)
        }
    }

    fn set_kind(&mut self, place: &Place, kind: Kind) {
        self.value_kinds.insert(place.identifier.id, kind);
    }

    /// `visitPlace(place)`: a use of a `KnownHook` as a first-class value is an
    /// invalid-hook-usage error.
    fn visit_place(&mut self, place: &Place) {
        if self.value_kinds.get(&place.identifier.id).copied() == Some(Kind::KnownHook) {
            self.has_error = true;
        }
    }

    /// `recordConditionalHookError(place)`: a conditional hook call. Marks the
    /// callee `Error` so further issues for the same hook are suppressed.
    fn record_conditional_hook_error(&mut self, place: &Place) {
        self.set_kind(place, Kind::Error);
        self.has_error = true;
    }
}

/// `validateHooksUsage(fn)` — returns `true` iff the function contains a
/// Rules-of-Hooks violation (a conditional hook call, a hook used as a value, or
/// a hook called inside a nested function expression).
pub fn validate_hooks_usage(func: &HirFunction) -> bool {
    let unconditional = compute_unconditional_blocks(func);

    let mut v = Validator {
        value_kinds: HashMap::new(),
        has_error: false,
    };

    // Params: seed their kind (a hook-named param is a potential hook).
    for param in &func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &spread.place,
        };
        let kind = v.get_kind_for_place(place);
        v.set_kind(place, kind);
    }

    for block in func.body.blocks() {
        // Phis: join the kinds of known operands (hook-named phi starts as a
        // potential hook). Operands whose value is unknown are skipped.
        for phi in &block.phis {
            let mut kind = if place_name(&phi.place).is_some_and(is_hook_name) {
                Kind::PotentialHook
            } else {
                Kind::Local
            };
            for operand in phi.operands.values() {
                if let Some(&operand_kind) = v.value_kinds.get(&operand.identifier.id) {
                    kind = join_kinds(kind, operand_kind);
                }
            }
            v.value_kinds.insert(phi.place.identifier.id, kind);
        }

        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadGlobal { .. } => {
                    // Globals are the source of known hooks: a global typed as a
                    // hook is `KnownHook`, else `Global`.
                    if get_hook_kind(&instr.lvalue.identifier).is_some() {
                        v.set_kind(&instr.lvalue, Kind::KnownHook);
                    } else {
                        v.set_kind(&instr.lvalue, Kind::Global);
                    }
                }
                InstructionValue::LoadContext { place, .. }
                | InstructionValue::LoadLocal { place, .. } => {
                    v.visit_place(place);
                    let kind = v.get_kind_for_place(place);
                    v.set_kind(&instr.lvalue, kind);
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    v.visit_place(value);
                    let kind = join_kinds(
                        v.get_kind_for_place(value),
                        v.get_kind_for_place(&lvalue.place),
                    );
                    v.set_kind(&lvalue.place, kind);
                    v.set_kind(&instr.lvalue, kind);
                }
                InstructionValue::StoreContext { place, value, .. } => {
                    // The TS `StoreContext` joins `value` with the store's lvalue
                    // place; our model carries the store's place directly.
                    v.visit_place(value);
                    let kind =
                        join_kinds(v.get_kind_for_place(value), v.get_kind_for_place(place));
                    v.set_kind(place, kind);
                    v.set_kind(&instr.lvalue, kind);
                }
                InstructionValue::ComputedLoad { object, .. } => {
                    v.visit_place(object);
                    let kind = v.get_kind_for_place(object);
                    let lvalue_kind = v.get_kind_for_place(&instr.lvalue);
                    v.set_kind(&instr.lvalue, join_kinds(lvalue_kind, kind));
                }
                InstructionValue::PropertyLoad {
                    object, property, ..
                } => {
                    let object_kind = v.get_kind_for_place(object);
                    let is_hook_property = match property {
                        crate::hir::value::PropertyLiteral::String(name) => is_hook_name(name),
                        crate::hir::value::PropertyLiteral::Number(_) => false,
                    };
                    let kind = property_load_kind(object_kind, is_hook_property);
                    v.set_kind(&instr.lvalue, kind);
                }
                InstructionValue::CallExpression { callee, .. } => {
                    let callee_kind = v.get_kind_for_place(callee);
                    let is_hook_callee =
                        callee_kind == Kind::KnownHook || callee_kind == Kind::PotentialHook;
                    if is_hook_callee && !unconditional.contains(&block.id) {
                        v.record_conditional_hook_error(callee);
                    } else if callee_kind == Kind::PotentialHook {
                        // recordDynamicHookUsageError: a dynamic (value-changing)
                        // potential-hook call.
                        v.has_error = true;
                    }
                    // The callee is validated above; check the remaining operands.
                    for operand in each_instruction_value_operand(&instr.value) {
                        if operand.identifier.id == callee.identifier.id {
                            continue;
                        }
                        v.visit_place(operand);
                    }
                }
                InstructionValue::MethodCall { property, .. } => {
                    let callee_kind = v.get_kind_for_place(property);
                    let is_hook_callee =
                        callee_kind == Kind::KnownHook || callee_kind == Kind::PotentialHook;
                    if is_hook_callee && !unconditional.contains(&block.id) {
                        v.record_conditional_hook_error(property);
                    } else if callee_kind == Kind::PotentialHook {
                        v.has_error = true;
                    }
                    for operand in each_instruction_value_operand(&instr.value) {
                        if operand.identifier.id == property.identifier.id {
                            continue;
                        }
                        v.visit_place(operand);
                    }
                }
                InstructionValue::Destructure { value, .. } => {
                    v.visit_place(value);
                    let object_kind = v.get_kind_for_place(value);
                    // `eachInstructionLValue(instr)` yields `instr.lvalue` (the
                    // Destructure result temporary) first, then each pattern place.
                    let lvalues: Vec<&Place> = std::iter::once(&instr.lvalue)
                        .chain(each_instruction_value_lvalue(&instr.value))
                        .collect();
                    let updates: Vec<(IdentifierId, Kind)> = lvalues
                        .iter()
                        .map(|lvalue| {
                            let is_hook_property = place_name(lvalue).is_some_and(is_hook_name);
                            (
                                lvalue.identifier.id,
                                destructure_kind(object_kind, is_hook_property),
                            )
                        })
                        .collect();
                    for (id, kind) in updates {
                        v.value_kinds.insert(id, kind);
                    }
                }
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    visit_function_expression(&lowered_func.func, &mut v);
                }
                _ => {
                    // Else check usages of operands, but do *not* flow properties
                    // from operands into the lvalues.
                    for operand in each_instruction_value_operand(&instr.value) {
                        v.visit_place(operand);
                    }
                    for lvalue in each_instruction_value_lvalue(&instr.value) {
                        let kind = v.get_kind_for_place(lvalue);
                        v.set_kind(lvalue, kind);
                    }
                    // The instruction's result place itself (the TS
                    // `eachInstructionLValue` yields `instr.lvalue`).
                    let kind = v.get_kind_for_place(&instr.lvalue);
                    v.set_kind(&instr.lvalue, kind);
                }
            }
        }
        for operand in each_terminal_operand(&block.terminal) {
            v.visit_place(operand);
        }
    }

    v.has_error
}

/// The `PropertyLoad` kind table (the TS `switch (objectKind)` in the
/// `PropertyLoad` case).
fn property_load_kind(object_kind: Kind, is_hook_property: bool) -> Kind {
    match object_kind {
        Kind::Error => Kind::Error,
        Kind::KnownHook => {
            if is_hook_property {
                Kind::KnownHook
            } else {
                Kind::Local
            }
        }
        Kind::PotentialHook => Kind::PotentialHook,
        Kind::Global => {
            if is_hook_property {
                Kind::KnownHook
            } else {
                Kind::Global
            }
        }
        Kind::Local => {
            if is_hook_property {
                Kind::PotentialHook
            } else {
                Kind::Local
            }
        }
    }
}

/// The `Destructure` kind table (the TS `switch (objectKind)` in the
/// `Destructure` case).
fn destructure_kind(object_kind: Kind, is_hook_property: bool) -> Kind {
    match object_kind {
        Kind::Error => Kind::Error,
        Kind::KnownHook => Kind::KnownHook,
        Kind::PotentialHook => Kind::PotentialHook,
        Kind::Global => {
            if is_hook_property {
                Kind::KnownHook
            } else {
                Kind::Global
            }
        }
        Kind::Local => {
            if is_hook_property {
                Kind::PotentialHook
            } else {
                Kind::Local
            }
        }
    }
}

/// `visitFunctionExpression(env, fn)`: a hook called inside a (nested) function
/// expression is always invalid. Recurses into nested functions.
fn visit_function_expression(func: &HirFunction, v: &mut Validator) {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::ObjectMethod { lowered_func, .. }
                | InstructionValue::FunctionExpression { lowered_func, .. } => {
                    visit_function_expression(&lowered_func.func, v);
                }
                InstructionValue::CallExpression { callee, .. } => {
                    if get_hook_kind(&callee.identifier).is_some() {
                        v.has_error = true;
                    }
                }
                InstructionValue::MethodCall { property, .. } => {
                    if get_hook_kind(&property.identifier).is_some() {
                        v.has_error = true;
                    }
                }
                _ => {}
            }
        }
    }
}
