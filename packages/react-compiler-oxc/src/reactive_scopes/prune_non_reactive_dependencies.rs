//! `PruneNonReactiveDependencies`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneNonReactiveDependencies.ts`
//! (+ `CollectReactiveIdentifiers.ts`).
//!
//! `PropagateScopeDependencies` infers dependencies without considering whether
//! they are actually reactive (whether their value can change over time). This
//! pass prunes dependencies that are guaranteed to be non-reactive.
//!
//! Two phases, both single forward passes over the reactive tree:
//! 1. `collectReactiveIdentifiers(fn)` seeds a `Set<IdentifierId>` from every
//!    place (including lvalues) marked `reactive`, plus, for pruned scopes, each
//!    declaration that is neither a primitive nor a stable (non-reactive) ref.
//! 2. The `Visitor` forward-propagates reactivity through `LoadLocal` /
//!    `StoreLocal` / `Destructure` / `PropertyLoad` / `ComputedLoad`, and on each
//!    `scope` block prunes non-reactive `scope.dependencies`, then (if any
//!    dependency survives) marks the scope's declarations + reassignments
//!    reactive so reactivity flows to its outputs.
//!
//! Traversal order matters: the TS `visitScope`/`visitInstruction` traverse
//! children *before* acting, so we mirror that depth-first source order.

use std::collections::HashSet;

use crate::hir::ids::IdentifierId;
use crate::hir::place::{Identifier, Place, Type};
use crate::hir::value::{
    ArrayPatternItem, InstructionValue, ObjectPatternProperty, Pattern,
};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};

/// `pruneNonReactiveDependencies(fn)`.
pub fn prune_non_reactive_dependencies(func: &mut ReactiveFunction) {
    let mut reactive = collect_reactive_identifiers(func);
    visit_block(&mut func.body, &mut reactive);
}

// ---- type predicates (HIR.ts) ----

/// `isPrimitiveType(id)`.
fn is_primitive_type(id: &Identifier) -> bool {
    matches!(id.type_, Type::Primitive)
}

/// `isUseRefType(id)`: shape id `BuiltInUseRefId`.
fn is_use_ref_type(id: &Identifier) -> bool {
    matches!(&id.type_, Type::Object { shape_id: Some(s) } if s == "BuiltInUseRefId")
}

/// `isStableType(id)` (the `InferReactivePlaces` predicate) — a stable,
/// identity-preserving builtin value (setState/dispatch/ref/startTransition/…).
fn is_stable_type(id: &Identifier) -> bool {
    let ty = &id.type_;
    let is_fn = |s: &str| matches!(ty, Type::Function { shape_id: Some(x), .. } if x == s);
    let is_obj = |s: &str| matches!(ty, Type::Object { shape_id: Some(x) } if x == s);
    is_fn("BuiltInSetState")
        || is_fn("BuiltInSetActionState")
        || is_fn("BuiltInDispatch")
        || is_obj("BuiltInUseRefId")
        || is_fn("BuiltInStartTransition")
        || is_fn("BuiltInSetOptimistic")
}

// ---- phase 1: collectReactiveIdentifiers ----

/// `isStableRefType(id, reactive)`: a `useRef` whose id is not (yet) reactive.
fn is_stable_ref_type(id: &Identifier, reactive: &HashSet<IdentifierId>) -> bool {
    is_use_ref_type(id) && !reactive.contains(&id.id)
}

/// `collectReactiveIdentifiers(fn)`: every reactive place id, plus non-primitive
/// non-stable-ref declarations of pruned scopes.
fn collect_reactive_identifiers(func: &ReactiveFunction) -> HashSet<IdentifierId> {
    let mut state = HashSet::new();
    collect_block(&func.body, &mut state);
    state
}

fn collect_place(place: &Place, state: &mut HashSet<IdentifierId>) {
    if place.reactive {
        state.insert(place.identifier.id);
    }
}

fn collect_value(value: &ReactiveValue, state: &mut HashSet<IdentifierId>) {
    for place in each_reactive_value_operand(value) {
        collect_place(place, state);
    }
    // The visitor also recurses into the lvalues nested in compound values'
    // instructions (Sequence members). `each_reactive_value_operand` already
    // flattens the member rvalues; member lvalues are visited below.
    if let ReactiveValue::Sequence(seq) = value {
        for instr in &seq.instructions {
            collect_instruction(instr, state);
        }
    }
}

fn collect_instruction(instruction: &ReactiveInstruction, state: &mut HashSet<IdentifierId>) {
    // `visitLValue` -> `visitPlace`: the lvalue place is visited for reactivity.
    if let Some(lvalue) = &instruction.lvalue {
        collect_place(lvalue, state);
    }
    if let ReactiveValue::Instruction(value) = &instruction.value {
        for lvalue in instruction_value_lvalues(value) {
            collect_place(lvalue, state);
        }
    }
    collect_value(&instruction.value, state);
}

fn collect_terminal(terminal: &ReactiveTerminal, state: &mut HashSet<IdentifierId>) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            collect_place(value, state);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            collect_value(init, state);
            collect_value(test, state);
            collect_block(loop_, state);
            if let Some(update) = update {
                collect_value(update, state);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            collect_value(init, state);
            collect_value(test, state);
            collect_block(loop_, state);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            collect_value(init, state);
            collect_block(loop_, state);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            collect_block(loop_, state);
            collect_value(test, state);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            collect_value(test, state);
            collect_block(loop_, state);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            collect_place(test, state);
            collect_block(consequent, state);
            if let Some(alternate) = alternate {
                collect_block(alternate, state);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            collect_place(test, state);
            for case in cases {
                if let Some(case_test) = &case.test {
                    collect_place(case_test, state);
                }
                if let Some(block) = &case.block {
                    collect_block(block, state);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => collect_block(block, state),
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            collect_block(block, state);
            if let Some(binding) = handler_binding {
                collect_place(binding, state);
            }
            collect_block(handler, state);
        }
    }
}

fn collect_block(block: &ReactiveBlock, state: &mut HashSet<IdentifierId>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instruction) => collect_instruction(instruction, state),
            ReactiveStatement::Scope(scope) => collect_block(&scope.instructions, state),
            ReactiveStatement::PrunedScope(scope) => {
                // `traversePrunedScope` then mark non-primitive / non-stable-ref
                // declarations reactive.
                collect_block(&scope.instructions, state);
                for (id, decl) in &scope.scope.declarations {
                    if !is_primitive_type(&decl.identifier)
                        && !is_stable_ref_type(&decl.identifier, state)
                    {
                        state.insert(*id);
                    }
                }
            }
            ReactiveStatement::Terminal(stmt) => collect_terminal(&stmt.terminal, state),
        }
    }
}

// ---- phase 2: propagate + prune ----

fn visit_block(block: &mut ReactiveBlock, state: &mut HashSet<IdentifierId>) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => visit_instruction(instruction, state),
            ReactiveStatement::Scope(scope) => visit_scope(scope, state),
            ReactiveStatement::PrunedScope(scope) => visit_block(&mut scope.instructions, state),
            ReactiveStatement::Terminal(stmt) => visit_terminal(&mut stmt.terminal, state),
        }
    }
}

fn visit_terminal(terminal: &mut ReactiveTerminal, state: &mut HashSet<IdentifierId>) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => visit_block(loop_, state),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            visit_block(consequent, state);
            if let Some(alternate) = alternate {
                visit_block(alternate, state);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    visit_block(block, state);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => visit_block(block, state),
        ReactiveTerminal::Try { block, handler, .. } => {
            visit_block(block, state);
            visit_block(handler, state);
        }
    }
}

fn visit_scope(scope: &mut ReactiveScopeBlock, state: &mut HashSet<IdentifierId>) {
    // `traverseScope` first.
    visit_block(&mut scope.instructions, state);

    // Prune non-reactive dependencies (preserving order).
    scope
        .scope
        .dependencies
        .retain(|dep| state.contains(&dep.identifier.id));

    if !scope.scope.dependencies.is_empty() {
        // Any reactive dependency makes the scope's outputs reactive.
        for (_, declaration) in &scope.scope.declarations {
            state.insert(declaration.identifier.id);
        }
        for reassignment in &scope.scope.reassignments {
            state.insert(reassignment.id);
        }
    }
}

fn visit_instruction(instruction: &mut ReactiveInstruction, state: &mut HashSet<IdentifierId>) {
    // `traverseInstruction` visits nested Sequence members first.
    if let ReactiveValue::Sequence(seq) = &mut instruction.value {
        for instr in seq.instructions.iter_mut() {
            visit_instruction(instr, state);
        }
    }

    let lvalue_id = instruction.lvalue.as_ref().map(|p| p.identifier.id);
    let ReactiveValue::Instruction(value) = &instruction.value else {
        return;
    };
    match value.as_ref() {
        InstructionValue::LoadLocal { place, .. } => {
            if let Some(lid) = lvalue_id {
                if state.contains(&place.identifier.id) {
                    state.insert(lid);
                }
            }
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            if state.contains(&value.identifier.id) {
                state.insert(lvalue.place.identifier.id);
                if let Some(lid) = lvalue_id {
                    state.insert(lid);
                }
            }
        }
        InstructionValue::Destructure { lvalue, value, .. } => {
            if state.contains(&value.identifier.id) {
                for pat_lvalue in pattern_operands(&lvalue.pattern) {
                    if is_stable_type(&pat_lvalue.identifier) {
                        continue;
                    }
                    state.insert(pat_lvalue.identifier.id);
                }
                if let Some(lid) = lvalue_id {
                    state.insert(lid);
                }
            }
        }
        InstructionValue::PropertyLoad { object, .. } => {
            if let Some(lid) = lvalue_id {
                if state.contains(&object.identifier.id)
                    && !is_stable_type_by_id(state, lid, instruction)
                {
                    state.insert(lid);
                }
            }
        }
        InstructionValue::ComputedLoad {
            object, property, ..
        } => {
            if let Some(lid) = lvalue_id {
                if state.contains(&object.identifier.id)
                    || state.contains(&property.identifier.id)
                {
                    state.insert(lid);
                }
            }
        }
        _ => {}
    }
}

/// `isStableType(lvalue.identifier)` for the `PropertyLoad` arm. The lvalue's
/// identifier is the instruction's `lvalue`.
fn is_stable_type_by_id(
    _state: &HashSet<IdentifierId>,
    _lid: IdentifierId,
    instruction: &ReactiveInstruction,
) -> bool {
    instruction
        .lvalue
        .as_ref()
        .is_some_and(|p| is_stable_type(&p.identifier))
}

// ---- pattern + lvalue operand helpers ----

/// `eachPatternOperand(pattern)`: the bound [`Place`]s of a destructuring pattern.
fn pattern_operands(pattern: &Pattern) -> Vec<&Place> {
    let mut out = Vec::new();
    match pattern {
        Pattern::Array(array) => {
            for item in &array.items {
                match item {
                    ArrayPatternItem::Place(place) => out.push(place),
                    ArrayPatternItem::Spread(spread) => out.push(&spread.place),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &object.properties {
                match property {
                    ObjectPatternProperty::Property(p) => out.push(&p.place),
                    ObjectPatternProperty::Spread(spread) => out.push(&spread.place),
                }
            }
        }
    }
    out
}

/// `eachInstructionLValue`-equivalent for a base [`InstructionValue`]: the extra
/// lvalue places carried inside the value (Destructure pattern operands, and the
/// `lvalue.place` of Store/Declare forms). Used by `collectReactiveIdentifiers`,
/// which visits *all* lvalue places for reactivity.
fn instruction_value_lvalues(value: &InstructionValue) -> Vec<&Place> {
    match value {
        InstructionValue::Destructure { lvalue, .. } => pattern_operands(&lvalue.pattern),
        InstructionValue::StoreLocal { lvalue, .. } | InstructionValue::DeclareLocal { lvalue, .. } => {
            vec![&lvalue.place]
        }
        InstructionValue::DeclareContext { place, .. } | InstructionValue::StoreContext { place, .. } => {
            vec![place]
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => vec![lvalue],
        _ => Vec::new(),
    }
}

/// `eachReactiveValueOperand(value)`: operand places, descending into the compound
/// reactive value forms (Logical/Ternary/Sequence/Optional) like the TS generator.
pub fn each_reactive_value_operand(value: &ReactiveValue) -> Vec<&Place> {
    let mut out = Vec::new();
    push_reactive_value_operands(value, &mut out);
    out
}

fn push_reactive_value_operands<'a>(value: &'a ReactiveValue, out: &mut Vec<&'a Place>) {
    match value {
        ReactiveValue::OptionalCall(optional) => {
            push_reactive_value_operands(&optional.value, out);
        }
        ReactiveValue::Logical(logical) => {
            push_reactive_value_operands(&logical.left, out);
            push_reactive_value_operands(&logical.right, out);
        }
        ReactiveValue::Sequence(sequence) => {
            for instr in &sequence.instructions {
                push_reactive_value_operands(&instr.value, out);
            }
            push_reactive_value_operands(&sequence.value, out);
        }
        ReactiveValue::Ternary(ternary) => {
            push_reactive_value_operands(&ternary.test, out);
            push_reactive_value_operands(&ternary.consequent, out);
            push_reactive_value_operands(&ternary.alternate, out);
        }
        ReactiveValue::Instruction(value) => {
            out.extend(crate::passes::cfg::each_instruction_value_operand(value));
        }
    }
}
