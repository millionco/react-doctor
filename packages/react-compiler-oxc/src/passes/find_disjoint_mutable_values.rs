//! `findDisjointMutableValues(fn)` — port of the same function in
//! `ReactiveScopes/InferReactiveScopeVariables.ts`.
//!
//! Groups identifiers that are mutably aliased into a [`DisjointSet`], so a later
//! pass can treat the whole group as one unit. [`infer_reactive_places`](super::infer_reactive_places)
//! uses it so reactivity flowing into one member of an alias group makes the whole
//! group reactive (handling readonly aliases created before mutation).
//!
//! `enableForest` is off in this environment (the config has no such flag), so the
//! `else if (fn.env.config.enableForest)` branch is never taken.

use std::collections::HashMap;

use crate::hir::ids::{DeclarationId, IdentifierId, InstructionId};
use crate::hir::instruction::Instruction;
use crate::hir::model::HirFunction;
use crate::hir::place::{Identifier, MutableRange, Place};
use crate::hir::value::{ArrayPatternItem, InstructionValue, ObjectPatternProperty, Pattern};

use super::cfg::each_instruction_value_operand;
use super::disjoint_set::DisjointSet;

/// `findDisjointMutableValues(fn)`.
pub fn find_disjoint_mutable_values(func: &HirFunction) -> DisjointSet<IdentifierId> {
    let mut scope_identifiers: DisjointSet<IdentifierId> = DisjointSet::new();
    // `declarations`: first identifier seen per declaration id.
    let mut declarations: HashMap<DeclarationId, IdentifierId> = HashMap::new();

    for block in func.body.blocks() {
        // Phis mutated after creation: alias the phi place + declaration + operands.
        for phi in &block.phis {
            let range = phi.place.identifier.mutable_range;
            let block_first_id = block
                .instructions
                .first()
                .map(|i| i.id)
                .unwrap_or_else(|| block.terminal.id());
            if range.start.as_u32() + 1 != range.end.as_u32()
                && range.end.as_u32() > block_first_id.as_u32()
            {
                let mut operands: Vec<IdentifierId> = vec![phi.place.identifier.id];
                if let Some(decl) =
                    declarations.get(&phi.place.identifier.declaration_id).copied()
                {
                    operands.push(decl);
                }
                for operand in phi.operands.values() {
                    operands.push(operand.identifier.id);
                }
                scope_identifiers.union(&operands);
            }
        }

        for instr in &block.instructions {
            let mut operands: Vec<IdentifierId> = Vec::new();
            let range = instr.lvalue.identifier.mutable_range;
            if range.end.as_u32() > range.start.as_u32() + 1 || may_allocate(instr) {
                operands.push(instr.lvalue.identifier.id);
            }
            match &instr.value {
                InstructionValue::DeclareLocal { lvalue, .. } => {
                    declare_identifier(&mut declarations, &lvalue.place.identifier);
                }
                InstructionValue::DeclareContext { place, .. } => {
                    declare_identifier(&mut declarations, &place.identifier);
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    declare_identifier(&mut declarations, &lvalue.place.identifier);
                    let lrange = lvalue.place.identifier.mutable_range;
                    if lrange.end.as_u32() > lrange.start.as_u32() + 1 {
                        operands.push(lvalue.place.identifier.id);
                    }
                    if is_mutable(instr.id, value) && value.identifier.mutable_range.start.as_u32() > 0
                    {
                        operands.push(value.identifier.id);
                    }
                }
                InstructionValue::StoreContext { place, value, .. } => {
                    declare_identifier(&mut declarations, &place.identifier);
                    let lrange = place.identifier.mutable_range;
                    if lrange.end.as_u32() > lrange.start.as_u32() + 1 {
                        operands.push(place.identifier.id);
                    }
                    if is_mutable(instr.id, value) && value.identifier.mutable_range.start.as_u32() > 0
                    {
                        operands.push(value.identifier.id);
                    }
                }
                InstructionValue::Destructure { lvalue, value, .. } => {
                    for place in pattern_operands(&lvalue.pattern) {
                        declare_identifier(&mut declarations, &place.identifier);
                        let prange = place.identifier.mutable_range;
                        if prange.end.as_u32() > prange.start.as_u32() + 1 {
                            operands.push(place.identifier.id);
                        }
                    }
                    if is_mutable(instr.id, value) && value.identifier.mutable_range.start.as_u32() > 0
                    {
                        operands.push(value.identifier.id);
                    }
                }
                InstructionValue::MethodCall { property, .. } => {
                    for operand in each_instruction_value_operand(&instr.value) {
                        if is_mutable(instr.id, operand)
                            && operand.identifier.mutable_range.start.as_u32() > 0
                        {
                            operands.push(operand.identifier.id);
                        }
                    }
                    // Keep the method-resolution ComputedLoad in the call's scope.
                    operands.push(property.identifier.id);
                }
                _ => {
                    for operand in each_instruction_value_operand(&instr.value) {
                        if is_mutable(instr.id, operand)
                            && operand.identifier.mutable_range.start.as_u32() > 0
                        {
                            operands.push(operand.identifier.id);
                        }
                    }
                }
            }
            if !operands.is_empty() {
                scope_identifiers.union(&operands);
            }
        }
    }

    scope_identifiers
}

fn declare_identifier(declarations: &mut HashMap<DeclarationId, IdentifierId>, id: &Identifier) {
    declarations.entry(id.declaration_id).or_insert(id.id);
}

/// `inRange(instr, place.identifier.mutableRange)` / `isMutable`.
fn is_mutable(instr_id: InstructionId, place: &Place) -> bool {
    in_range(instr_id, &place.identifier.mutable_range)
}

fn in_range(id: InstructionId, range: &MutableRange) -> bool {
    id.as_u32() >= range.start.as_u32() && id.as_u32() < range.end.as_u32()
}

/// `mayAllocate(env, instruction)`.
fn may_allocate(instr: &Instruction) -> bool {
    use crate::hir::place::Type;
    match &instr.value {
        InstructionValue::Destructure { lvalue, .. } => {
            does_pattern_contain_spread_element(&lvalue.pattern)
        }
        InstructionValue::PostfixUpdate { .. }
        | InstructionValue::PrefixUpdate { .. }
        | InstructionValue::Await { .. }
        | InstructionValue::DeclareLocal { .. }
        | InstructionValue::DeclareContext { .. }
        | InstructionValue::StoreLocal { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::TypeCastExpression { .. }
        | InstructionValue::LoadLocal { .. }
        | InstructionValue::LoadContext { .. }
        | InstructionValue::StoreContext { .. }
        | InstructionValue::PropertyDelete { .. }
        | InstructionValue::ComputedLoad { .. }
        | InstructionValue::ComputedDelete { .. }
        | InstructionValue::JsxText { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::GetIterator { .. }
        | InstructionValue::IteratorNext { .. }
        | InstructionValue::NextPropertyOf { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::StartMemoize { .. }
        | InstructionValue::FinishMemoize { .. }
        | InstructionValue::UnaryExpression { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::PropertyLoad { .. }
        | InstructionValue::StoreGlobal { .. } => false,
        InstructionValue::TaggedTemplateExpression { .. }
        | InstructionValue::CallExpression { .. }
        | InstructionValue::MethodCall { .. } => {
            !matches!(instr.lvalue.identifier.type_, Type::Primitive)
        }
        InstructionValue::RegExpLiteral { .. }
        | InstructionValue::PropertyStore { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::JsxExpression { .. }
        | InstructionValue::JsxFragment { .. }
        | InstructionValue::NewExpression { .. }
        | InstructionValue::ObjectExpression { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::ObjectMethod { .. }
        | InstructionValue::FunctionExpression { .. } => true,
    }
}

/// `doesPatternContainSpreadElement(pattern)`.
fn does_pattern_contain_spread_element(pattern: &Pattern) -> bool {
    match pattern {
        Pattern::Array(array) => array
            .items
            .iter()
            .any(|i| matches!(i, ArrayPatternItem::Spread(_))),
        Pattern::Object(object) => object
            .properties
            .iter()
            .any(|p| matches!(p, ObjectPatternProperty::Spread(_))),
    }
}

/// `eachPatternOperand(pattern)`: the pattern's bound places (holes skipped).
fn pattern_operands(pattern: &Pattern) -> Vec<&Place> {
    let mut out: Vec<&Place> = Vec::new();
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
                    ObjectPatternProperty::Spread(s) => out.push(&s.place),
                }
            }
        }
    }
    out
}
