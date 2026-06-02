//! `RewriteInstructionKindsBasedOnReassignment` — port of
//! `SSA/RewriteInstructionKindsBasedOnReassignment.ts`.
//!
//! Rewrites the [`InstructionKind`] of variable-declaring/assigning instructions:
//! the first declaration of a binding becomes `Const` (or `Let` if subsequently
//! reassigned), and later reassignments become `Reassign`. A `let` whose
//! reassignment was DCE'd can become `const`.
//!
//! ## Rust-vs-TS modeling note
//!
//! The TS mutates the *prior* declaration's `kind` in place when a reassignment
//! is found (via a shared `LValue` reference in the `declarations` map). Here
//! lvalues are owned by their instructions, so we record each declaration's
//! [`Location`] (which lvalue, where) and apply the deferred `kind = Let`
//! flip in a second walk after computing every binding's final kind.

use std::collections::HashMap;

use crate::hir::ids::{BlockId, DeclarationId};
use crate::hir::model::HirFunction;
use crate::hir::value::{InstructionKind, InstructionValue, Pattern};

/// Where a binding's controlling lvalue lives, so a deferred `kind = Let` flip
/// can be applied. Params/context declarations live only in the synthetic map
/// (never rendered), so they need no location.
#[derive(Clone, Copy)]
enum Location {
    /// A synthetic param/context declaration (no rendered lvalue to flip).
    Header,
    /// `block[block].instructions[instr].value`'s single lvalue
    /// (`DeclareLocal`/`StoreLocal`).
    Single { block: BlockId, instr: usize },
    /// `block[block].instructions[instr].value`'s destructure pattern lvalue.
    Pattern { block: BlockId, instr: usize },
}

/// `rewriteInstructionKindsBasedOnReassignment(fn)`.
pub fn rewrite_instruction_kinds_based_on_reassignment(func: &mut HirFunction) {
    // We process each block independently in CFG order, but the `declarations`
    // map is function-wide (TS iterates all blocks with one shared map).
    let mut declarations: HashMap<DeclarationId, Location> = HashMap::new();

    // Seed params + context with synthetic `Let` declarations (Header location;
    // their kind is not rendered, so a later `kind = Let` flip is a no-op).
    for param in &func.params {
        let place = match param {
            crate::hir::model::FunctionParam::Place(p) => p,
            crate::hir::model::FunctionParam::Spread(s) => &s.place,
        };
        if place.identifier.name.is_some() {
            declarations.insert(place.identifier.declaration_id, Location::Header);
        }
    }
    for place in &func.context {
        if place.identifier.name.is_some() {
            declarations.insert(place.identifier.declaration_id, Location::Header);
        }
    }

    // Deferred `kind = Let` flips for prior declarations, keyed by location.
    let mut flip_to_let: Vec<Location> = Vec::new();

    let block_ids: Vec<crate::hir::ids::BlockId> =
        func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let instr_count = func.body.block(block_id).expect("block").instructions.len();
        for i in 0..instr_count {
            // Snapshot what we need from the instruction.
            let info = {
                let block = func.body.block(block_id).expect("block");
                classify(&block.instructions[i].value)
            };
            match info {
                Classified::DeclareLocal { decl_id } => {
                    declarations.insert(decl_id, Location::Single { block: block_id, instr: i });
                }
                Classified::StoreLocal { decl_id, named } => {
                    if named {
                        if let Some(prior) = declarations.get(&decl_id).copied() {
                            // Prior declaration -> Let; this -> Reassign.
                            flip_to_let.push(prior);
                            set_single_kind(func, block_id, i, InstructionKind::Reassign);
                        } else {
                            declarations
                                .insert(decl_id, Location::Single { block: block_id, instr: i });
                            set_single_kind(func, block_id, i, InstructionKind::Const);
                        }
                    }
                }
                Classified::Destructure { operands } => {
                    // Determine the consistent kind across operands.
                    let mut kind: Option<InstructionKind> = None;
                    for (decl_id, named) in &operands {
                        if !named {
                            kind = Some(InstructionKind::Const);
                        } else if let Some(prior) = declarations.get(decl_id).copied() {
                            kind = Some(InstructionKind::Reassign);
                            flip_to_let.push(prior);
                        } else {
                            declarations
                                .insert(*decl_id, Location::Pattern { block: block_id, instr: i });
                            kind = Some(InstructionKind::Const);
                        }
                    }
                    if let Some(kind) = kind {
                        set_pattern_kind(func, block_id, i, kind);
                    }
                }
                Classified::Update { decl_id } => {
                    if let Some(prior) = declarations.get(&decl_id).copied() {
                        flip_to_let.push(prior);
                    }
                }
                Classified::Other => {}
            }
        }
    }

    // Apply deferred prior-declaration flips to `Let`.
    for loc in flip_to_let {
        match loc {
            Location::Header => {}
            Location::Single { block, instr } => {
                set_single_kind(func, block, instr, InstructionKind::Let)
            }
            Location::Pattern { block, instr } => {
                set_pattern_kind(func, block, instr, InstructionKind::Let)
            }
        }
    }
}

/// The decl-relevant classification of an instruction value.
enum Classified {
    DeclareLocal { decl_id: DeclarationId },
    StoreLocal { decl_id: DeclarationId, named: bool },
    Destructure { operands: Vec<(DeclarationId, bool)> },
    Update { decl_id: DeclarationId },
    Other,
}

fn classify(value: &InstructionValue) -> Classified {
    match value {
        InstructionValue::DeclareLocal { lvalue, .. } => Classified::DeclareLocal {
            decl_id: lvalue.place.identifier.declaration_id,
        },
        InstructionValue::StoreLocal { lvalue, .. } => Classified::StoreLocal {
            decl_id: lvalue.place.identifier.declaration_id,
            named: lvalue.place.identifier.name.is_some(),
        },
        InstructionValue::Destructure { lvalue, .. } => {
            let mut operands = Vec::new();
            collect_pattern(&lvalue.pattern, &mut operands);
            Classified::Destructure { operands }
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => Classified::Update {
            decl_id: lvalue.identifier.declaration_id,
        },
        _ => Classified::Other,
    }
}

fn collect_pattern(pattern: &Pattern, out: &mut Vec<(DeclarationId, bool)>) {
    use crate::hir::value::{ArrayPatternItem, ObjectPatternProperty};
    match pattern {
        Pattern::Array(array) => {
            for item in &array.items {
                match item {
                    ArrayPatternItem::Place(place) => {
                        out.push((place.identifier.declaration_id, place.identifier.name.is_some()))
                    }
                    ArrayPatternItem::Spread(spread) => out.push((
                        spread.place.identifier.declaration_id,
                        spread.place.identifier.name.is_some(),
                    )),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &object.properties {
                match property {
                    ObjectPatternProperty::Property(property) => out.push((
                        property.place.identifier.declaration_id,
                        property.place.identifier.name.is_some(),
                    )),
                    ObjectPatternProperty::Spread(spread) => out.push((
                        spread.place.identifier.declaration_id,
                        spread.place.identifier.name.is_some(),
                    )),
                }
            }
        }
    }
}

fn set_single_kind(
    func: &mut HirFunction,
    block_id: crate::hir::ids::BlockId,
    instr: usize,
    kind: InstructionKind,
) {
    let block = func.body.block_mut(block_id).expect("block");
    set_single_kind_in_value(&mut block.instructions[instr].value, kind);
}

fn set_pattern_kind(
    func: &mut HirFunction,
    block_id: crate::hir::ids::BlockId,
    instr: usize,
    kind: InstructionKind,
) {
    let block = func.body.block_mut(block_id).expect("block");
    if let InstructionValue::Destructure { lvalue, .. } = &mut block.instructions[instr].value {
        lvalue.kind = kind;
    }
}

fn set_single_kind_in_value(value: &mut InstructionValue, kind: InstructionKind) {
    match value {
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => lvalue.kind = kind,
        _ => {}
    }
}
