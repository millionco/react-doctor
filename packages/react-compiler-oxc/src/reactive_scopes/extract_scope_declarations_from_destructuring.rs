//! `extractScopeDeclarationsFromDestructuring`, ported from
//! `packages/react-compiler/src/ReactiveScopes/ExtractScopeDeclarationsFromDestructuring.ts`.
//!
//! A destructuring may define some variables declared by the scope and others
//! used only locally:
//!
//! ```text
//! const {x, ...rest} = value;   // `x` is new, `rest` is scope-declared
//! ```
//!
//! The scope cannot redeclare `rest` but must declare `x`. This pass rewrites such
//! mixed destructurings so each scope-variable assignment is extracted to a
//! temporary that is reassigned in a separate instruction:
//!
//! ```text
//! const {x, ...t0} = value;     // declare new bindings, promote `rest` to a temp
//! rest = t0;                     // separate reassignment of the scope variable
//! ```
//!
//! Destructurings that are *all* reassignments simply have their lvalue kind set
//! to `Reassign` (no split). A `ReactiveFunctionTransform`: `transformInstruction`
//! may `replace-many` one destructure with `[destructure, reassign…]`.
//!
//! NOTE: on the current fixture corpus no mixed destructuring survives to this
//! pass, so it is a structural no-op there; it is ported faithfully for
//! completeness. The synthesized temporaries draw fresh identifier ids from the
//! shared [`PassContext`] (`env.nextIdentifierId`).

use std::collections::HashSet;

use crate::hir::ids::{DeclarationId, IdentifierId, TypeId};
use crate::hir::model::FunctionParam;
use crate::hir::place::{Identifier, Place, SourceLocation};
use crate::hir::value::{
    ArrayPatternItem, InstructionKind, InstructionValue, LValue, ObjectPatternProperty, Pattern,
};
use crate::passes::PassContext;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};

struct State<'a> {
    declared: HashSet<DeclarationId>,
    ctx: &'a mut PassContext,
}

/// `extractScopeDeclarationsFromDestructuring(fn)`.
pub fn extract_scope_declarations_from_destructuring(
    func: &mut ReactiveFunction,
    ctx: &mut PassContext,
) {
    let mut declared = HashSet::new();
    for param in &func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &spread.place,
        };
        declared.insert(place.identifier.declaration_id);
    }
    let mut state = State { declared, ctx };
    visit_block(&mut func.body, &mut state);
}

fn visit_block(block: &mut ReactiveBlock, state: &mut State) {
    let owned: Vec<ReactiveStatement> = std::mem::take(block);
    let mut next: Vec<ReactiveStatement> = Vec::with_capacity(owned.len());
    for stmt in owned {
        match stmt {
            ReactiveStatement::Instruction(instruction) => {
                let produced = transform_instruction(instruction, state);
                next.extend(produced);
            }
            ReactiveStatement::Scope(mut scope) => {
                visit_scope(&mut scope, state);
                next.push(ReactiveStatement::Scope(scope));
            }
            ReactiveStatement::PrunedScope(mut scope) => {
                visit_block(&mut scope.instructions, state);
                next.push(ReactiveStatement::PrunedScope(scope));
            }
            ReactiveStatement::Terminal(mut stmt) => {
                visit_terminal(&mut stmt.terminal, state);
                next.push(ReactiveStatement::Terminal(stmt));
            }
        }
    }
    *block = next;
}

fn visit_scope(scope: &mut ReactiveScopeBlock, state: &mut State) {
    for (_, declaration) in &scope.scope.declarations {
        state.declared.insert(declaration.identifier.declaration_id);
    }
    visit_block(&mut scope.instructions, state);
}

/// `transformInstruction`: split a mixed destructuring, then record declarations.
fn transform_instruction(
    mut instruction: ReactiveInstruction,
    state: &mut State,
) -> Vec<ReactiveStatement> {
    let mut produced: Vec<ReactiveInstruction> = Vec::new();
    let mut split = false;

    if let ReactiveValue::Instruction(value) = &mut instruction.value {
        if matches!(value.as_ref(), InstructionValue::Destructure { .. }) {
            if let Some(extra) = transform_destructuring(state, &instruction.id, value) {
                produced = extra;
                split = true;
            }
        }
    }

    let result: Vec<ReactiveStatement> = if split {
        let id = instruction.id;
        let loc = instruction.loc.clone();
        let mut out = vec![ReactiveStatement::Instruction(instruction)];
        for extra in produced {
            let _ = (id, &loc);
            out.push(ReactiveStatement::Instruction(extra));
        }
        out
    } else {
        vec![ReactiveStatement::Instruction(instruction)]
    };

    // Update `state.declared` from each produced instruction's non-reassign lvalues.
    for stmt in &result {
        if let ReactiveStatement::Instruction(instr) = stmt {
            for (place, kind) in instruction_lvalues_with_kind(instr) {
                if kind != InstructionKind::Reassign {
                    state.declared.insert(place.identifier.declaration_id);
                }
            }
        }
    }

    result
}

/// `transformDestructuring`: returns the extra reassignment instructions if the
/// destructure is a mix of declarations and reassignments, or `None` if it is all
/// reassignments (in which case the lvalue kind is set to `Reassign` in place).
fn transform_destructuring(
    state: &mut State,
    instr_id: &crate::hir::ids::InstructionId,
    value: &mut InstructionValue,
) -> Option<Vec<ReactiveInstruction>> {
    let InstructionValue::Destructure { lvalue, loc, .. } = value else {
        return None;
    };

    let mut reassigned: HashSet<IdentifierId> = HashSet::new();
    let mut has_declaration = false;
    for place in pattern_operands(&lvalue.pattern) {
        if state.declared.contains(&place.identifier.declaration_id) {
            reassigned.insert(place.identifier.id);
        } else {
            has_declaration = true;
        }
    }

    if !has_declaration {
        lvalue.kind = InstructionKind::Reassign;
        return None;
    }

    // Mixed: replace each reassigned operand with a temporary and emit a separate
    // reassignment for it.
    let destruct_loc = loc.clone();
    let mut renamed: Vec<(Place, Place)> = Vec::new();
    map_pattern_operands(&mut lvalue.pattern, &mut |place: &mut Place| {
        if !reassigned.contains(&place.identifier.id) {
            return;
        }
        let mut temporary = clone_place_to_temporary(state.ctx, place);
        temporary.identifier.promote_temporary();
        renamed.push((place.clone(), temporary.clone()));
        *place = temporary;
    });

    let mut instructions = Vec::new();
    for (original, temporary) in renamed {
        instructions.push(ReactiveInstruction {
            id: *instr_id,
            lvalue: None,
            value: ReactiveValue::Instruction(Box::new(InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: original,
                    kind: InstructionKind::Reassign,
                },
                value: temporary,
                type_annotation: None,
                loc: destruct_loc.clone(),
            })),
            effects: None,
            loc: destruct_loc.clone(),
        });
    }
    Some(instructions)
}

/// `clonePlaceToTemporary(env, place)`.
fn clone_place_to_temporary(ctx: &mut PassContext, place: &Place) -> Place {
    let id = ctx.next_identifier_id();
    let mut identifier = Identifier::make_temporary(id, TypeId::new(0), place.loc.clone());
    identifier.type_ = place.identifier.type_.clone();
    Place {
        identifier,
        effect: place.effect,
        reactive: place.reactive,
        loc: SourceLocation::Generated,
    }
}

/// `eachInstructionLValueWithKind(instr)`: lvalue places with their declaration
/// kind (the value-level lvalues; `instr.lvalue` carries no kind).
fn instruction_lvalues_with_kind(instr: &ReactiveInstruction) -> Vec<(&Place, InstructionKind)> {
    let mut out = Vec::new();
    if let ReactiveValue::Instruction(value) = &instr.value {
        match value.as_ref() {
            InstructionValue::DeclareLocal { lvalue, .. }
            | InstructionValue::StoreLocal { lvalue, .. } => out.push((&lvalue.place, lvalue.kind)),
            InstructionValue::DeclareContext { kind, place, .. }
            | InstructionValue::StoreContext { kind, place, .. } => out.push((place, *kind)),
            InstructionValue::Destructure { lvalue, .. } => {
                for place in pattern_operands(&lvalue.pattern) {
                    out.push((place, lvalue.kind));
                }
            }
            _ => {}
        }
    }
    out
}

/// `eachPatternOperand`: the bound places of a destructuring pattern.
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
                    ObjectPatternProperty::Property(property) => out.push(&property.place),
                    ObjectPatternProperty::Spread(spread) => out.push(&spread.place),
                }
            }
        }
    }
    out
}

/// `mapPatternOperands`: apply `f` to each bound pattern place in place.
fn map_pattern_operands(pattern: &mut Pattern, f: &mut impl FnMut(&mut Place)) {
    match pattern {
        Pattern::Array(array) => {
            for item in &mut array.items {
                match item {
                    ArrayPatternItem::Place(place) => f(place),
                    ArrayPatternItem::Spread(spread) => f(&mut spread.place),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &mut object.properties {
                match property {
                    ObjectPatternProperty::Property(property) => f(&mut property.place),
                    ObjectPatternProperty::Spread(spread) => f(&mut spread.place),
                }
            }
        }
    }
}

fn visit_terminal(terminal: &mut ReactiveTerminal, state: &mut State) {
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
