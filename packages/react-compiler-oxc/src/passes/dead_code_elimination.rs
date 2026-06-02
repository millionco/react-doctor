//! `DeadCodeElimination` — port of `Optimization/DeadCodeElimination.ts`.
//!
//! Eliminates instructions whose values are unused (unreachable blocks were
//! already pruned during HIR construction). The pass is two-phase:
//!
//! 1. [`find_referenced_identifiers`] computes the set of referenced identifier
//!    ids + names via a fixed-point reverse-postorder walk (usages are visited
//!    before declarations except across loop back-edges, so the walk iterates to a
//!    fixpoint when the CFG has a back-edge).
//! 2. The sweep prunes unreferenced phis and instructions, then rewrites retained
//!    `Destructure`/`StoreLocal` instructions (pruning unused pattern lvalues and
//!    converting always-overwritten `StoreLocal` declarations to `DeclareLocal` so
//!    the dead initializer can be DCE'd), and finally prunes unreferenced context
//!    variables.
//!
//! Block ids and order are preserved; retained instructions keep their original
//! ids (so the printed `[N]` sequence has gaps where instructions were deleted).
//! This pass runs immediately after `InferMutationAliasingEffects`; the
//! per-instruction aliasing `effects` lines ride along unchanged on the retained
//! instructions.
//!
//! The output mode is always `'client'` for the parity oracle, so the SSR-only
//! `useState`/`useReducer`/`useRef` pruning branch in `pruneableValue` is
//! unreachable here and is intentionally not modeled (the corresponding
//! `CallExpression`/`MethodCall` arm is always "not pruneable").

use std::collections::HashSet;

use crate::hir::model::{BlockKind, HirFunction};
use crate::hir::place::Identifier;
use crate::hir::value::{
    ArrayPatternItem, InstructionKind, InstructionValue, ObjectPattern, ObjectPatternProperty,
    Pattern,
};
use crate::passes::cfg::{each_instruction_value_operand, each_terminal_operand};

/// `findBlocksWithBackEdges(fn).size > 0`: whether any block has a predecessor
/// that has not yet been visited in block (reverse-postorder) iteration order —
/// i.e. a loop back-edge exists.
fn has_back_edge(func: &HirFunction) -> bool {
    let mut visited: HashSet<u32> = HashSet::new();
    for block in func.body.blocks() {
        for pred in block.preds.iter() {
            if !visited.contains(&pred.as_u32()) {
                return true;
            }
        }
        visited.insert(block.id.as_u32());
    }
    false
}

/// The reference-tracking state (`State` in the TS): the set of referenced SSA
/// identifier ids plus the set of referenced *names* (so any version of a named
/// variable keeps every SSA instance of it live).
struct State {
    named: HashSet<String>,
    identifiers: HashSet<u32>,
}

impl State {
    fn new() -> Self {
        State {
            named: HashSet::new(),
            identifiers: HashSet::new(),
        }
    }

    /// `reference(identifier)`: mark this id (and, if named, its name) as used.
    fn reference(&mut self, identifier: &Identifier) {
        self.identifiers.insert(identifier.id.as_u32());
        if let Some(name) = identifier_name(identifier) {
            self.named.insert(name);
        }
    }

    /// `isIdOrNameUsed`: this specific SSA id is used, or (for a named identifier)
    /// any version of the name is used.
    fn is_id_or_name_used(&self, identifier: &Identifier) -> bool {
        self.identifiers.contains(&identifier.id.as_u32())
            || identifier_name(identifier)
                .as_deref()
                .is_some_and(|name| self.named.contains(name))
    }

    /// `isIdUsed`: only this specific SSA id is used.
    fn is_id_used(&self, identifier: &Identifier) -> bool {
        self.identifiers.contains(&identifier.id.as_u32())
    }

    /// `state.count`: the number of distinct referenced SSA ids (the fixpoint
    /// progress measure).
    fn count(&self) -> usize {
        self.identifiers.len()
    }
}

/// `identifier.name.value` for named identifiers (`{kind: 'named' | 'promoted'}`),
/// or `None` for temporaries (`identifier.name === null`). The TS `State` keys its
/// `named` set on `IdentifierName.value` regardless of named-vs-promoted kind.
fn identifier_name(identifier: &Identifier) -> Option<String> {
    use crate::hir::place::IdentifierName;
    match &identifier.name {
        Some(IdentifierName::Named { value }) | Some(IdentifierName::Promoted { value }) => {
            Some(value.clone())
        }
        None => None,
    }
}

/// Phase 1: compute the referenced-identifier set via the fixed-point
/// reverse-postorder walk (`findReferencedIdentifiers`).
fn find_referenced_identifiers(func: &HirFunction) -> State {
    let has_loop = has_back_edge(func);
    let mut state = State::new();

    loop {
        // `size = state.count` at the top of each iteration (the TS `do/while`).
        let size = state.count();

        // Iterate blocks in postorder (successors before predecessors, excepting
        // loops): the stored block order is reverse-postorder, so reverse it.
        for block in func.body.blocks().iter().rev() {
            for operand in each_terminal_operand(&block.terminal) {
                state.reference(&operand.identifier);
            }

            let len = block.instructions.len();
            for i in (0..len).rev() {
                let instr = &block.instructions[i];
                let is_block_value = block.kind != BlockKind::Block && i == len - 1;

                if is_block_value {
                    // The last instr of a value block is the block's value and is
                    // never pruned: pessimistically mark its lvalue + all operands.
                    state.reference(&instr.lvalue.identifier);
                    for place in each_instruction_value_operand(&instr.value) {
                        state.reference(&place.identifier);
                    }
                } else if state.is_id_or_name_used(&instr.lvalue.identifier)
                    || !pruneable_value(&instr.value, &state)
                {
                    state.reference(&instr.lvalue.identifier);

                    if let InstructionValue::StoreLocal { lvalue, value, .. } = &instr.value {
                        // For a Let/Const declaration, mark the initializer as
                        // referenced only if the ssa'ed lval is also referenced.
                        if lvalue.kind == InstructionKind::Reassign
                            || state.is_id_used(&lvalue.place.identifier)
                        {
                            state.reference(&value.identifier);
                        }
                    } else {
                        for operand in each_instruction_value_operand(&instr.value) {
                            state.reference(&operand.identifier);
                        }
                    }
                }
            }

            for phi in &block.phis {
                if state.is_id_or_name_used(&phi.place.identifier) {
                    for (_pred, operand) in phi.operands.iter() {
                        state.reference(&operand.identifier);
                    }
                }
            }
        }

        if !(state.count() > size && has_loop) {
            break;
        }
    }

    state
}

/// `deadCodeElimination(fn)`: the two-phase pass.
pub fn dead_code_elimination(func: &mut HirFunction) {
    // Phase 1: find/mark all referenced identifiers.
    let state = find_referenced_identifiers(func);

    // Phase 2: prune/sweep unreferenced identifiers and instructions.
    for block in func.body.blocks_mut() {
        let block_kind = block.kind;

        // Prune unreferenced phis.
        block
            .phis
            .retain(|phi| state.is_id_or_name_used(&phi.place.identifier));

        // Prune instructions whose lvalue is not referenced.
        block
            .instructions
            .retain(|instr| state.is_id_or_name_used(&instr.lvalue.identifier));

        // Rewrite retained instructions (except the value-block's value instr).
        let len = block.instructions.len();
        for i in 0..len {
            let is_block_value = block_kind != BlockKind::Block && i == len - 1;
            if !is_block_value {
                rewrite_instruction(&mut block.instructions[i], &state);
            }
        }
    }

    // Constant propagation and DCE may have deleted/rewritten instructions that
    // referenced context variables — prune the now-unreferenced ones.
    func.context
        .retain(|context_var| state.is_id_or_name_used(&context_var.identifier));
}

/// `rewriteInstruction(instr, state)`: prune unused destructure lvalues and
/// rewrite always-overwritten `StoreLocal` declarations to `DeclareLocal`.
fn rewrite_instruction(instr: &mut crate::hir::instruction::Instruction, state: &State) {
    match &mut instr.value {
        InstructionValue::Destructure { lvalue, .. } => match &mut lvalue.pattern {
            Pattern::Array(array) => {
                // Prune items prior to the end by replacing them with a Hole; drop
                // trailing unused items entirely.
                let mut last_entry_index = 0usize;
                for (i, item) in array.items.iter_mut().enumerate() {
                    let used = match item {
                        ArrayPatternItem::Place(place) => {
                            state.is_id_or_name_used(&place.identifier)
                        }
                        ArrayPatternItem::Spread(spread) => {
                            state.is_id_or_name_used(&spread.place.identifier)
                        }
                        ArrayPatternItem::Hole => {
                            // Holes are neither used nor advance the last index.
                            continue;
                        }
                    };
                    if used {
                        last_entry_index = i;
                    } else {
                        *item = ArrayPatternItem::Hole;
                    }
                }
                array.items.truncate(last_entry_index + 1);
            }
            Pattern::Object(object) => {
                rewrite_object_pattern(object, state);
            }
        },
        InstructionValue::StoreLocal {
            lvalue,
            type_annotation,
            loc,
            ..
        } => {
            if lvalue.kind != InstructionKind::Reassign
                && !state.is_id_used(&lvalue.place.identifier)
            {
                // A const/let declaration whose variable is read later, but whose
                // initializer value is always overwritten before being read.
                // Rewrite to DeclareLocal so the initializer can be DCE'd.
                let lvalue = lvalue.clone();
                let type_annotation = type_annotation.clone();
                let loc = loc.clone();
                instr.value = InstructionValue::DeclareLocal {
                    lvalue,
                    type_annotation,
                    loc,
                };
            }
        }
        _ => {}
    }
}

/// Prune unused properties of an `ObjectPattern`, unless a used rest element
/// exists (`const {x, ...y} = z`): if a used rest exists, removing any property
/// would change which keys flow into the rest value, so nothing is pruned.
fn rewrite_object_pattern(object: &mut ObjectPattern, state: &State) {
    let mut next_properties: Option<Vec<ObjectPatternProperty>> = None;
    let mut keep_all = false;
    for property in &object.properties {
        match property {
            ObjectPatternProperty::Property(prop) => {
                if state.is_id_or_name_used(&prop.place.identifier) {
                    next_properties
                        .get_or_insert_with(Vec::new)
                        .push(property.clone());
                }
            }
            ObjectPatternProperty::Spread(spread) => {
                if state.is_id_or_name_used(&spread.place.identifier) {
                    keep_all = true;
                    break;
                }
            }
        }
    }
    if keep_all {
        return;
    }
    if let Some(next) = next_properties {
        object.properties = next;
    }
}

/// `pruneableValue(value, state)`: whether it is safe to prune an instruction with
/// the given value. Mirrors the TS exhaustive switch. The output mode is always
/// `'client'` for parity, so the SSR-only hook-pruning branch never fires — the
/// `CallExpression`/`MethodCall` arm is always not-pruneable here.
fn pruneable_value(value: &InstructionValue, state: &State) -> bool {
    match value {
        InstructionValue::DeclareLocal { lvalue, .. } => {
            // Declarations are pruneable only if the named variable is never read.
            !state.is_id_or_name_used(&lvalue.place.identifier)
        }
        InstructionValue::StoreLocal { lvalue, .. } => {
            if lvalue.kind == InstructionKind::Reassign {
                // Reassignments: pruneable if this specific instance is never read.
                !state.is_id_used(&lvalue.place.identifier)
            } else {
                !state.is_id_or_name_used(&lvalue.place.identifier)
            }
        }
        InstructionValue::Destructure { lvalue, .. } => {
            let mut is_id_or_name_used = false;
            let mut is_id_used = false;
            for place in each_pattern_operand(&lvalue.pattern) {
                if state.is_id_used(&place.identifier) {
                    is_id_or_name_used = true;
                    is_id_used = true;
                } else if state.is_id_or_name_used(&place.identifier) {
                    is_id_or_name_used = true;
                }
            }
            if lvalue.kind == InstructionKind::Reassign {
                !is_id_used
            } else {
                !is_id_or_name_used
            }
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => {
            // Updates: pruneable if this specific instance is never read.
            !state.is_id_used(&lvalue.identifier)
        }
        // Explicitly retained to not break debugging workflows.
        InstructionValue::Debugger { .. } => false,
        // Always not-pruneable in 'client' mode (the SSR hook-pruning branch is
        // unreachable for the parity oracle).
        InstructionValue::CallExpression { .. } | InstructionValue::MethodCall { .. } => false,
        // Mutating instructions are not safe to prune.
        InstructionValue::Await { .. }
        | InstructionValue::ComputedDelete { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::PropertyDelete { .. }
        | InstructionValue::PropertyStore { .. }
        | InstructionValue::StoreGlobal { .. } => false,
        // Potentially safe, but conservatively retained (may create new values).
        InstructionValue::NewExpression { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::TaggedTemplateExpression { .. } => false,
        // Iterator primitives are conceptually unpruneable.
        InstructionValue::GetIterator { .. }
        | InstructionValue::NextPropertyOf { .. }
        | InstructionValue::IteratorNext { .. } => false,
        // Context instructions are not pruneable.
        InstructionValue::LoadContext { .. }
        | InstructionValue::DeclareContext { .. }
        | InstructionValue::StoreContext { .. } => false,
        // Memoization markers preserve memoization guarantees; not pruneable.
        InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => false,
        // Definitely safe to prune (read-only).
        InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::ComputedLoad { .. }
        | InstructionValue::ObjectMethod { .. }
        | InstructionValue::FunctionExpression { .. }
        | InstructionValue::LoadLocal { .. }
        | InstructionValue::JsxExpression { .. }
        | InstructionValue::JsxFragment { .. }
        | InstructionValue::JsxText { .. }
        | InstructionValue::ObjectExpression { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::PropertyLoad { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::TypeCastExpression { .. }
        | InstructionValue::UnaryExpression { .. } => true,
    }
}

/// `eachPatternOperand(pattern)`: the bound places of a destructuring pattern, in
/// source order (array items, then object properties), skipping holes.
fn each_pattern_operand(pattern: &Pattern) -> Vec<&crate::hir::place::Place> {
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
                    ObjectPatternProperty::Property(prop) => out.push(&prop.place),
                    ObjectPatternProperty::Spread(spread) => out.push(&spread.place),
                }
            }
        }
    }
    out
}
