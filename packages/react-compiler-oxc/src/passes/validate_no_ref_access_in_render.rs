//! `validateNoRefAccessInRender` (`Validation/ValidateNoRefAccessInRender.ts`):
//! flags accessing a ref value (`ref.current`) during render, directly or
//! indirectly (passing a ref to a function that reads it). Implemented as the
//! upstream abstract interpretation: a `RefAccessType` lattice over a fixpoint,
//! with guard tracking for the safe `if (ref.current == null)` initialization
//! pattern so it does not false-positive.

use std::collections::{HashMap, HashSet};

use crate::diagnostic::{Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::{BlockId, IdentifierId};
use crate::hir::instruction::AliasingEffect;
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::{Identifier, Place, SourceLocation};
use crate::hir::terminal::Terminal;
use crate::hir::type_checks::{is_ref_value_type, is_use_ref_type};
use crate::hir::value::{InstructionValue, PrimitiveValue, PropertyLiteral};

use super::cfg::{each_instruction_value_lvalue, each_instruction_value_operand, each_terminal_operand};
use super::infer_reactive_places::get_hook_kind;

const ERROR_DESCRIPTION: &str = "React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected (https://react.dev/reference/react/useRef)";
const REASON: &str = "Cannot access refs during render";

const MSG_CANNOT_ACCESS: &str = "Cannot access ref value during render";
const MSG_PASSING: &str = "Passing a ref to a function may read its value during render";
const MSG_UPDATE: &str = "Cannot update ref during render";
const MSG_FN_ACCESSES: &str = "This function accesses a ref value";
const HINT: &str = "To initialize a ref only once, check that the ref is null with the pattern `if (ref.current == null) { ref.current = ... }`";

type RefId = u32;

#[derive(Clone, Debug, PartialEq)]
enum RefAccessType {
    None,
    Nullable,
    Guard(RefId),
    Ref(RefId),
    RefValue { loc: Option<SourceLocation>, ref_id: Option<RefId> },
    Structure { value: Option<Box<RefAccessType>>, function: Option<RefFnType> },
}

#[derive(Clone, Debug, PartialEq)]
struct RefFnType {
    read_ref_effect: bool,
    return_type: Box<RefAccessType>,
}

struct Counter {
    next: RefId,
}

impl Counter {
    fn next(&mut self) -> RefId {
        let id = self.next;
        self.next += 1;
        id
    }
}

/// Whether `a` and `b` are the same lattice point (`tyEqual`).
fn ty_equal(a: &RefAccessType, b: &RefAccessType) -> bool {
    use RefAccessType::*;
    match (a, b) {
        (None, None) | (Ref(_), Ref(_)) | (Nullable, Nullable) => true,
        (Guard(x), Guard(y)) => x == y,
        (RefValue { loc: la, .. }, RefValue { loc: lb, .. }) => la == lb,
        (
            Structure { value: va, function: fa },
            Structure { value: vb, function: fb },
        ) => {
            let fns_equal = match (fa, fb) {
                (Option::None, Option::None) => true,
                (Some(a), Some(b)) => {
                    a.read_ref_effect == b.read_ref_effect && ty_equal(&a.return_type, &b.return_type)
                }
                _ => false,
            };
            let values_equal = match (va, vb) {
                (Option::None, Option::None) => true,
                (Some(a), Some(b)) => ty_equal(a, b),
                _ => false,
            };
            fns_equal && values_equal
        }
        _ => false,
    }
}

fn join_ref_ref(a: &RefAccessType, b: &RefAccessType, counter: &mut Counter) -> RefAccessType {
    use RefAccessType::*;
    match (a, b) {
        (RefValue { ref_id: ra, loc, .. }, RefValue { ref_id: rb, .. }) => {
            if ra.is_some() && ra == rb {
                a.clone()
            } else {
                let _ = loc;
                RefValue { loc: Option::None, ref_id: Option::None }
            }
        }
        (RefValue { .. }, _) => a.clone(),
        (_, RefValue { .. }) => b.clone(),
        (Ref(ra), Ref(rb)) if ra == rb => a.clone(),
        (Ref(_), _) | (_, Ref(_)) => Ref(counter.next()),
        (
            Structure { value: va, function: fa },
            Structure { value: vb, function: fb },
        ) => {
            let function = match (fa, fb) {
                (Option::None, _) => fb.clone(),
                (_, Option::None) => fa.clone(),
                (Some(a), Some(b)) => Some(RefFnType {
                    read_ref_effect: a.read_ref_effect || b.read_ref_effect,
                    return_type: Box::new(join_types(&[*a.return_type.clone(), *b.return_type.clone()], counter)),
                }),
            };
            let value = match (va, vb) {
                (Option::None, _) => vb.clone(),
                (_, Option::None) => va.clone(),
                (Some(a), Some(b)) => Some(Box::new(join_ref_ref(a, b, counter))),
            };
            Structure { value, function }
        }
        _ => a.clone(),
    }
}

fn join_types(types: &[RefAccessType], counter: &mut Counter) -> RefAccessType {
    use RefAccessType::*;
    let mut acc = None;
    for b in types {
        acc = match (&acc, b) {
            (None, _) => b.clone(),
            (_, None) => acc,
            (Guard(ra), Guard(rb)) if ra == rb => acc,
            (Guard(_), Nullable) | (Guard(_), Guard(_)) => None,
            (Guard(_), other) => other.clone(),
            (_, Guard(_)) => {
                if matches!(acc, Nullable) {
                    None
                } else {
                    b.clone()
                }
            }
            (Nullable, _) => b.clone(),
            (_, Nullable) => acc,
            (a, b) => join_ref_ref(a, b, counter),
        };
    }
    acc
}

struct Env {
    changed: bool,
    data: HashMap<IdentifierId, RefAccessType>,
    temporaries: HashMap<IdentifierId, IdentifierId>,
    counter: Counter,
}

impl Env {
    fn resolve(&self, id: IdentifierId) -> IdentifierId {
        self.temporaries.get(&id).copied().unwrap_or(id)
    }

    fn define(&mut self, place: &Place, value_id: IdentifierId) {
        let target = self.resolve(value_id);
        self.temporaries.insert(place.identifier.id, target);
    }

    fn get(&self, id: IdentifierId) -> Option<RefAccessType> {
        self.data.get(&self.resolve(id)).cloned()
    }

    fn set(&mut self, id: IdentifierId, value: RefAccessType) {
        let key = self.resolve(id);
        let cur = self.data.get(&key).cloned();
        let widened = join_types(
            &[value, cur.clone().unwrap_or(RefAccessType::None)],
            &mut self.counter,
        );
        let unchanged_none = cur.is_none() && widened == RefAccessType::None;
        let changed = !unchanged_none
            && match &cur {
                Option::None => true,
                Some(prev) => !ty_equal(prev, &widened),
            };
        if changed {
            self.changed = true;
        }
        self.data.insert(key, widened);
    }
}

fn ref_type_of_type(identifier: &Identifier, counter: &mut Counter) -> RefAccessType {
    if is_ref_value_type(identifier) {
        RefAccessType::RefValue { loc: Option::None, ref_id: Option::None }
    } else if is_use_ref_type(identifier) {
        RefAccessType::Ref(counter.next())
    } else {
        RefAccessType::None
    }
}

fn place_id(place: &Place) -> IdentifierId {
    place.identifier.id
}

fn is_use_ref_property_load(value: &InstructionValue) -> bool {
    matches!(
        value,
        InstructionValue::PropertyLoad { object, property, .. }
            if is_use_ref_type(&object.identifier)
                && matches!(property, PropertyLiteral::String(s) if s == "current")
    )
}

/// `collectTemporariesSidemap`: alias temporaries through LoadLocal/StoreLocal
/// and non-`.current` PropertyLoad so the lattice keys collapse to the source.
fn collect_temporaries_sidemap(func: &HirFunction, env: &mut Env) {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadLocal { place, .. } => {
                    env.define(&instr.lvalue, place_id(place));
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    env.define(&instr.lvalue, place_id(value));
                    env.define(&lvalue.place, place_id(value));
                }
                InstructionValue::PropertyLoad { object, .. } => {
                    if is_use_ref_property_load(&instr.value) {
                        continue;
                    }
                    env.define(&instr.lvalue, place_id(object));
                }
                _ => {}
            }
        }
    }
}

fn destructured(ty: Option<RefAccessType>) -> Option<RefAccessType> {
    match ty {
        Some(RefAccessType::Structure { value: Some(value), .. }) => destructured(Some(*value)),
        other => other,
    }
}

struct Validator<'a> {
    resolver: &'a PositionResolver<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Validator<'a> {
    fn push(&mut self, loc: &SourceLocation, message: &str, hint: Option<&str>) {
        let mut diagnostic = Diagnostic::create(ErrorCategory::Refs, REASON)
            .with_description(ERROR_DESCRIPTION)
            .with_error_detail(self.resolver.resolve(loc), Some(message.to_string()));
        if let Some(_hint) = hint {
            // Hints are advisory; modeled as an additional detail with no location.
            diagnostic = diagnostic.with_error_detail(Option::None, Some(_hint.to_string()));
        }
        self.diagnostics.push(diagnostic);
    }

    fn no_ref_value_access(&mut self, env: &Env, operand: &Place) {
        let ty = destructured(env.get(place_id(operand)));
        let is_error = matches!(&ty, Some(RefAccessType::RefValue { .. }))
            || matches!(&ty, Some(RefAccessType::Structure { function: Some(f), .. }) if f.read_ref_effect);
        if is_error {
            let loc = ref_value_loc(&ty).unwrap_or(operand.loc.clone());
            self.push(&loc, MSG_CANNOT_ACCESS, Option::None);
        }
    }

    fn no_direct_ref_value_access(&mut self, env: &Env, operand: &Place) {
        let ty = destructured(env.get(place_id(operand)));
        if let Some(RefAccessType::RefValue { loc, .. }) = &ty {
            let at = loc.clone().unwrap_or(operand.loc.clone());
            self.push(&at, MSG_CANNOT_ACCESS, Option::None);
        }
    }

    fn no_ref_passed_to_function(&mut self, env: &Env, operand: &Place, loc: &SourceLocation) {
        let ty = destructured(env.get(place_id(operand)));
        let is_error = matches!(&ty, Some(RefAccessType::Ref(_)) | Some(RefAccessType::RefValue { .. }))
            || matches!(&ty, Some(RefAccessType::Structure { function: Some(f), .. }) if f.read_ref_effect);
        if is_error {
            let at = ref_value_loc(&ty).unwrap_or(loc.clone());
            self.push(&at, MSG_PASSING, Option::None);
        }
    }

    fn no_ref_update(&mut self, env: &Env, operand: &Place, loc: &SourceLocation) {
        let ty = destructured(env.get(place_id(operand)));
        if matches!(&ty, Some(RefAccessType::Ref(_)) | Some(RefAccessType::RefValue { .. })) {
            let at = ref_value_loc(&ty).unwrap_or(loc.clone());
            self.push(&at, MSG_UPDATE, Option::None);
        }
    }

    fn guard_check(&mut self, env: &Env, operand: &Place) {
        if matches!(env.get(place_id(operand)), Some(RefAccessType::Guard(_))) {
            self.push(&operand.loc, MSG_CANNOT_ACCESS, Option::None);
        }
    }
}

fn ref_value_loc(ty: &Option<RefAccessType>) -> Option<SourceLocation> {
    match ty {
        Some(RefAccessType::RefValue { loc: Some(loc), .. }) => Some(loc.clone()),
        _ => Option::None,
    }
}

pub fn validate_no_ref_access_in_render(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    let mut env = Env {
        changed: false,
        data: HashMap::new(),
        temporaries: HashMap::new(),
        counter: Counter { next: 0 },
    };
    collect_temporaries_sidemap(func, &mut env);
    let mut validator = Validator { resolver, diagnostics: Vec::new() };
    validate_impl(func, &mut env, &mut validator);
    for diagnostic in validator.diagnostics {
        diagnostics.push(diagnostic);
    }
}

fn validate_impl(func: &HirFunction, env: &mut Env, validator: &mut Validator) {
    for param in &func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &spread.place,
        };
        let ty = ref_type_of_type(&place.identifier, &mut env.counter);
        env.set(place_id(place), ty);
    }

    let mut interpolated_as_jsx: HashSet<IdentifierId> = HashSet::new();
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::JsxExpression { children: Some(children), .. } => {
                    for child in children {
                        interpolated_as_jsx.insert(place_id(child));
                    }
                }
                InstructionValue::JsxFragment { children, .. } => {
                    for child in children {
                        interpolated_as_jsx.insert(place_id(child));
                    }
                }
                _ => {}
            }
        }
    }

    for iteration in 0..10 {
        if iteration > 0 && !env.changed {
            break;
        }
        env.changed = false;
        let start = validator.diagnostics.len();
        let mut safe_blocks: Vec<(BlockId, RefId)> = Vec::new();

        for block in func.body.blocks() {
            safe_blocks.retain(|(b, _)| *b != block.id);

            for phi in &block.phis {
                let operands: Vec<RefAccessType> = phi
                    .operands
                    .values()
                    .map(|operand| env.get(place_id(operand)).unwrap_or(RefAccessType::None))
                    .collect();
                let joined = join_types(&operands, &mut env.counter);
                env.set(phi.place.identifier.id, joined);
            }

            for instr in &block.instructions {
                visit_instruction(instr, env, validator, &interpolated_as_jsx, &mut safe_blocks);
            }

            // `if (guard)` makes the fallthrough block safe for that ref.
            if let Terminal::If { test, fallthrough, .. } = &block.terminal {
                if let Some(RefAccessType::Guard(ref_id)) = env.get(place_id(test)) {
                    if !safe_blocks.iter().any(|(_, r)| *r == ref_id) {
                        safe_blocks.push((*fallthrough, ref_id));
                    }
                }
            }

            let is_return = matches!(block.terminal, Terminal::Return { .. });
            let is_if = matches!(block.terminal, Terminal::If { .. });
            for operand in each_terminal_operand(&block.terminal) {
                if !is_return {
                    validator.no_ref_value_access(env, operand);
                    if !is_if {
                        validator.guard_check(env, operand);
                    }
                } else {
                    validator.no_direct_ref_value_access(env, operand);
                    validator.guard_check(env, operand);
                }
            }
        }

        if validator.diagnostics.len() > start {
            // The TS returns on the first iteration that records any error,
            // surfacing the earliest (pre-further-widening) diagnostics.
            return;
        }
    }
}

fn visit_instruction(
    instr: &crate::hir::instruction::Instruction,
    env: &mut Env,
    validator: &mut Validator,
    interpolated_as_jsx: &HashSet<IdentifierId>,
    safe_blocks: &mut Vec<(BlockId, RefId)>,
) {
    let lvalue_id = instr.lvalue.identifier.id;
    match &instr.value {
        InstructionValue::JsxExpression { .. } | InstructionValue::JsxFragment { .. } => {
            for operand in each_instruction_value_operand(&instr.value) {
                validator.no_direct_ref_value_access(env, operand);
            }
        }
        InstructionValue::ComputedLoad { object, property, .. } => {
            validator.no_direct_ref_value_access(env, property);
            let lookup = ref_lookup_for_object(env, place_id(object), &instr.loc);
            let ty = lookup.unwrap_or_else(|| ref_type_of_type(&instr.lvalue.identifier, &mut env.counter));
            env.set(lvalue_id, ty);
        }
        InstructionValue::PropertyLoad { object, .. } => {
            let lookup = ref_lookup_for_object(env, place_id(object), &instr.loc);
            let ty = lookup.unwrap_or_else(|| ref_type_of_type(&instr.lvalue.identifier, &mut env.counter));
            env.set(lvalue_id, ty);
        }
        InstructionValue::TypeCastExpression { value, .. } => {
            let ty = env
                .get(place_id(value))
                .unwrap_or_else(|| ref_type_of_type(&instr.lvalue.identifier, &mut env.counter));
            env.set(lvalue_id, ty);
        }
        InstructionValue::LoadContext { place, .. } | InstructionValue::LoadLocal { place, .. } => {
            let ty = env
                .get(place_id(place))
                .unwrap_or_else(|| ref_type_of_type(&instr.lvalue.identifier, &mut env.counter));
            env.set(lvalue_id, ty);
        }
        InstructionValue::StoreContext { place, value, .. } => {
            let ty = env
                .get(place_id(value))
                .unwrap_or_else(|| ref_type_of_type(&place.identifier, &mut env.counter));
            env.set(place_id(place), ty.clone());
            env.set(lvalue_id, env.get(place_id(value)).unwrap_or(ty));
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            let ty = env
                .get(place_id(value))
                .unwrap_or_else(|| ref_type_of_type(&lvalue.place.identifier, &mut env.counter));
            env.set(lvalue.place.identifier.id, ty.clone());
            env.set(
                lvalue_id,
                env.get(place_id(value)).unwrap_or(ty),
            );
        }
        InstructionValue::Destructure { value, .. } => {
            let obj = env.get(place_id(value));
            let lookup = match &obj {
                Some(RefAccessType::Structure { value: Some(v), .. }) => Some((**v).clone()),
                _ => Option::None,
            };
            let result = lookup
                .clone()
                .unwrap_or_else(|| ref_type_of_type(&instr.lvalue.identifier, &mut env.counter));
            env.set(lvalue_id, result);
            for lval in each_instruction_value_lvalue(&instr.value) {
                let ty = lookup
                    .clone()
                    .unwrap_or_else(|| ref_type_of_type(&lval.identifier, &mut env.counter));
                env.set(lval.identifier.id, ty);
            }
        }
        InstructionValue::ObjectMethod { lowered_func, .. }
        | InstructionValue::FunctionExpression { lowered_func, .. } => {
            let before = validator.diagnostics.len();
            validate_impl(&lowered_func.func, env, validator);
            let had_errors = validator.diagnostics.len() > before;
            // The nested-function diagnostics are folded into the function's
            // `readRefEffect`; drop them here (the call site re-reports).
            validator.diagnostics.truncate(before);
            let return_type = if had_errors {
                RefAccessType::None
            } else {
                RefAccessType::None
            };
            env.set(
                lvalue_id,
                RefAccessType::Structure {
                    function: Some(RefFnType { read_ref_effect: had_errors, return_type: Box::new(return_type) }),
                    value: Option::None,
                },
            );
        }
        InstructionValue::MethodCall { property, .. } => {
            visit_call(instr, env, validator, interpolated_as_jsx, property);
        }
        InstructionValue::CallExpression { callee, .. } => {
            visit_call(instr, env, validator, interpolated_as_jsx, callee);
        }
        InstructionValue::ObjectExpression { .. } | InstructionValue::ArrayExpression { .. } => {
            let mut types = Vec::new();
            for operand in each_instruction_value_operand(&instr.value) {
                validator.no_direct_ref_value_access(env, operand);
                types.push(env.get(place_id(operand)).unwrap_or(RefAccessType::None));
            }
            let value = join_types(&types, &mut env.counter);
            match value {
                RefAccessType::None | RefAccessType::Guard(_) | RefAccessType::Nullable => {
                    env.set(lvalue_id, RefAccessType::None);
                }
                other => env.set(
                    lvalue_id,
                    RefAccessType::Structure { value: Some(Box::new(other)), function: Option::None },
                ),
            }
        }
        InstructionValue::PropertyStore { object, value, .. } => {
            let target = env.get(place_id(object));
            let mut handled_safe = false;
            if let Some(RefAccessType::Ref(ref_id)) = &target {
                if let Some(pos) = safe_blocks.iter().position(|(_, r)| r == ref_id) {
                    safe_blocks.remove(pos);
                    handled_safe = true;
                }
            }
            if !handled_safe {
                validator.no_ref_update(env, object, &instr.loc);
            }
            validator.no_direct_ref_value_access(env, value);
            if let Some(RefAccessType::Structure { .. }) = env.get(place_id(value)) {
                let value_ty = env.get(place_id(value)).unwrap();
                let object_ty = match target {
                    Some(t) => join_types(&[value_ty, t], &mut env.counter),
                    Option::None => value_ty,
                };
                env.set(place_id(object), object_ty);
            }
        }
        InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => {}
        InstructionValue::LoadGlobal { binding, .. } => {
            if binding_is_undefined(binding) {
                env.set(lvalue_id, RefAccessType::Nullable);
            }
        }
        InstructionValue::Primitive { value, .. } => {
            if matches!(value, PrimitiveValue::Null | PrimitiveValue::Undefined) {
                env.set(lvalue_id, RefAccessType::Nullable);
            }
        }
        InstructionValue::UnaryExpression { operator, value, .. } => {
            if operator == "!" {
                if let Some(RefAccessType::RefValue { ref_id: Some(ref_id), .. }) = env.get(place_id(value)) {
                    env.set(lvalue_id, RefAccessType::Guard(ref_id));
                    validator.push(&value.loc, MSG_CANNOT_ACCESS, Some(HINT));
                    return;
                }
            }
            validator.no_ref_value_access(env, value);
        }
        InstructionValue::BinaryExpression { left, right, .. } => {
            let left_ty = env.get(place_id(left));
            let right_ty = env.get(place_id(right));
            let ref_id = match (&left_ty, &right_ty) {
                (Some(RefAccessType::RefValue { ref_id: Some(id), .. }), _) => Some(*id),
                (_, Some(RefAccessType::RefValue { ref_id: Some(id), .. })) => Some(*id),
                _ => Option::None,
            };
            let nullish = matches!(left_ty, Some(RefAccessType::Nullable))
                || matches!(right_ty, Some(RefAccessType::Nullable));
            if let (Some(ref_id), true) = (ref_id, nullish) {
                env.set(lvalue_id, RefAccessType::Guard(ref_id));
            } else {
                for operand in each_instruction_value_operand(&instr.value) {
                    validator.no_ref_value_access(env, operand);
                }
            }
        }
        _ => {
            for operand in each_instruction_value_operand(&instr.value) {
                validator.no_ref_value_access(env, operand);
            }
        }
    }

    // Guard values may only be used in `if` targets.
    for operand in each_instruction_value_operand(&instr.value) {
        validator.guard_check(env, operand);
    }

    // A useRef-typed lvalue is always a Ref; a RefValue-typed lvalue a RefValue.
    if is_use_ref_type(&instr.lvalue.identifier)
        && !matches!(env.get(lvalue_id), Some(RefAccessType::Ref(_)))
    {
        let ref_ty = RefAccessType::Ref(env.counter.next());
        let joined = join_types(
            &[env.get(lvalue_id).unwrap_or(RefAccessType::None), ref_ty],
            &mut env.counter,
        );
        env.set(lvalue_id, joined);
    }
    if is_ref_value_type(&instr.lvalue.identifier)
        && !matches!(env.get(lvalue_id), Some(RefAccessType::RefValue { .. }))
    {
        let ref_value = RefAccessType::RefValue { loc: Some(instr.loc.clone()), ref_id: Option::None };
        let joined = join_types(
            &[env.get(lvalue_id).unwrap_or(RefAccessType::None), ref_value],
            &mut env.counter,
        );
        env.set(lvalue_id, joined);
    }
}

fn ref_lookup_for_object(env: &mut Env, object_id: IdentifierId, loc: &SourceLocation) -> Option<RefAccessType> {
    match env.get(object_id) {
        Some(RefAccessType::Structure { value, .. }) => value.map(|v| *v),
        Some(RefAccessType::Ref(ref_id)) => Some(RefAccessType::RefValue {
            loc: Some(loc.clone()),
            ref_id: Some(ref_id),
        }),
        _ => Option::None,
    }
}

fn binding_is_undefined(binding: &crate::hir::value::NonLocalBinding) -> bool {
    use crate::hir::value::NonLocalBinding::*;
    matches!(binding, Global { name } if name == "undefined")
}

fn visit_call(
    instr: &crate::hir::instruction::Instruction,
    env: &mut Env,
    validator: &mut Validator,
    interpolated_as_jsx: &HashSet<IdentifierId>,
    callee: &Place,
) {
    let lvalue_id = instr.lvalue.identifier.id;
    let hook_kind = get_hook_kind(&callee.identifier);
    let mut return_type = RefAccessType::None;
    let mut did_error = false;

    if let Some(RefAccessType::Structure { function: Some(f), .. }) = env.get(place_id(callee)) {
        return_type = *f.return_type.clone();
        if f.read_ref_effect {
            did_error = true;
            validator.push(&callee.loc, MSG_FN_ACCESSES, Option::None);
        }
    }

    if !did_error {
        let is_ref_lvalue = is_use_ref_type(&instr.lvalue.identifier);
        let is_non_state_hook = hook_kind.is_some()
            && !matches!(
                hook_kind,
                Some(super::infer_reactive_places::HookKind::UseState)
                    | Some(super::infer_reactive_places::HookKind::UseReducer)
            );
        if is_ref_lvalue || is_non_state_hook {
            for operand in each_instruction_value_operand(&instr.value) {
                validator.no_direct_ref_value_access(env, operand);
            }
        } else if interpolated_as_jsx.contains(&lvalue_id) {
            for operand in each_instruction_value_operand(&instr.value) {
                validator.no_ref_value_access(env, operand);
            }
        } else if hook_kind.is_none() && instr.effects.is_some() {
            visit_call_effects(instr, env, validator);
        } else {
            for operand in each_instruction_value_operand(&instr.value) {
                validator.no_ref_passed_to_function(env, operand, &operand.loc);
            }
        }
    }

    env.set(lvalue_id, return_type);
}

fn visit_call_effects(
    instr: &crate::hir::instruction::Instruction,
    env: &Env,
    validator: &mut Validator,
) {
    let Some(effects) = &instr.effects else { return };
    let mut visited: HashSet<(IdentifierId, u8)> = HashSet::new();
    for effect in effects {
        // 0 = none, 1 = ref-passed, 2 = direct-ref
        let (place, validation): (Option<&Place>, u8) = match effect {
            AliasingEffect::Freeze { value, .. } => (Some(value), 2),
            AliasingEffect::Mutate { value, .. }
            | AliasingEffect::MutateTransitive { value }
            | AliasingEffect::MutateConditionally { value }
            | AliasingEffect::MutateTransitiveConditionally { value } => (Some(value), 1),
            AliasingEffect::Render { place } => (Some(place), 1),
            AliasingEffect::Capture { from, .. }
            | AliasingEffect::Alias { from, .. }
            | AliasingEffect::MaybeAlias { from, .. }
            | AliasingEffect::Assign { from, .. }
            | AliasingEffect::CreateFrom { from, .. } => (Some(from), 1),
            AliasingEffect::ImmutableCapture { from, .. } => {
                let is_frozen = effects.iter().any(|other| {
                    matches!(other, AliasingEffect::Freeze { value, .. } if value.identifier.id == from.identifier.id)
                });
                (Some(from), if is_frozen { 2 } else { 1 })
            }
            _ => (Option::None, 0),
        };
        if let (Some(place), v) = (place, validation) {
            if v == 0 {
                continue;
            }
            let key = (place.identifier.id, v);
            if visited.insert(key) {
                if v == 2 {
                    validator.no_direct_ref_value_access(env, place);
                } else {
                    validator.no_ref_passed_to_function(env, place, &place.loc);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn refs_count(code: &str) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == ErrorCategory::Refs)
            .count()
    }

    const IMPORTS: &str = "import { useRef } from \"react\";\n";

    #[test]
    fn flags_ref_current_read_in_render() {
        let code = "function Component() {\n  const ref = useRef(null);\n  return <div>{ref.current}</div>;\n}\n";
        assert!(refs_count(&format!("{IMPORTS}{code}")) >= 1);
    }

    #[test]
    fn allows_ref_null_guard_pattern() {
        let code = "function Component() {\n  const ref = useRef(null);\n  if (ref.current == null) {\n    ref.current = compute();\n  }\n  return <div />;\n}\n";
        assert_eq!(refs_count(&format!("{IMPORTS}{code}")), 0);
    }

    #[test]
    fn allows_components_without_refs() {
        let code = "function Component(props) {\n  return <div>{props.a}</div>;\n}\n";
        assert_eq!(refs_count(&format!("{IMPORTS}{code}")), 0);
    }
}
