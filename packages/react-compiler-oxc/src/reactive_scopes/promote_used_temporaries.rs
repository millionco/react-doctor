//! `promoteUsedTemporaries`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PromoteUsedTemporaries.ts`.
//!
//! Promotes unnamed temporaries (`identifier.name === null`) that are used in a
//! position requiring a named variable into promoted names (`#t<declarationId>`,
//! or `#T<declarationId>` for JSX tag positions). Four phases over the reactive
//! tree, all keyed by [`DeclarationId`] so every instance of one declaration ends
//! up with the same name:
//!
//! 1. `CollectPromotableTemporaries` — records JSX-tag declarations (`tags`) and,
//!    for pruned scopes, declarations used outside their pruned scope (`pruned`).
//! 2. `PromoteTemporaries` — promotes params, scope dependencies, scope
//!    declarations, and the pruned-scope declarations flagged in phase 1.
//! 3. `PromoteInterposedTemporaries` — promotes temporaries whose inline emission
//!    would be reordered past an interposing statement-emitting instruction
//!    (preserving side-effect order).
//! 4. `PromoteAllInstancedOfPromotedTemporaries` — sweeps every place/lvalue/scope
//!    identifier, promoting all remaining instances of an already-promoted
//!    declaration.
//!
//! Nested HIR function bodies (`FunctionExpression`/`ObjectMethod` values) only
//! ever contain unnamed temporaries in the current corpus and none of their
//! declarations are promoted here, so the `visitHirFunction` recursion the TS
//! performs is a no-op on the fixtures and is intentionally not modeled.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{DeclarationId, IdentifierId, ScopeId};
use crate::hir::model::FunctionParam;
use crate::hir::place::{Identifier, Place};
use crate::hir::value::{InstructionKind, InstructionValue, JsxTag};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveStatement, ReactiveTerminal,
    ReactiveValue,
};
use super::prune_non_reactive_dependencies::each_reactive_value_operand;

/// Per-declaration promotion bookkeeping (TS `State`).
struct State {
    /// Declarations used as a JSX element tag (promoted with `#T…`).
    tags: HashSet<DeclarationId>,
    /// Declarations that have been promoted.
    promoted: HashSet<DeclarationId>,
    /// Pruned-scope declarations, with the scopes active at their definition and
    /// whether they were referenced outside that pruned scope.
    pruned: HashMap<DeclarationId, PrunedPlace>,
}

struct PrunedPlace {
    active_scopes: Vec<ScopeId>,
    used_outside_scope: bool,
}

/// `promoteUsedTemporaries(fn)`.
pub fn promote_used_temporaries(func: &mut ReactiveFunction) {
    let mut state = State {
        tags: HashSet::new(),
        promoted: HashSet::new(),
        pruned: HashMap::new(),
    };

    // Phase 1: collect JSX tags + pruned-scope usage.
    collect_block(&func.body, &mut state, &mut Vec::new());

    // Promote unnamed params (done before the PromoteTemporaries traversal, per TS).
    for param in &mut func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &mut spread.place,
        };
        if place.identifier.name.is_none() {
            promote_identifier(&mut place.identifier, &mut state);
        }
    }

    // Phase 2: promote scope deps/decls + flagged pruned-scope decls + params.
    promote_block(&mut func.body, &mut state);

    // Phase 3: promote interposed temporaries.
    let mut consts: HashSet<IdentifierId> = HashSet::new();
    for param in &func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &spread.place,
        };
        consts.insert(place.identifier.id);
    }
    let mut inter = InterState {
        promotable: &mut state,
        consts,
        globals: HashSet::new(),
        seen: HashMap::new(),
    };
    interpose_block(&mut func.body, &mut inter);

    // Phase 4: sweep all remaining instances of promoted declarations.
    sweep_block(&mut func.body, &mut state);
}

/// `promoteIdentifier(identifier, state)`.
fn promote_identifier(identifier: &mut Identifier, state: &mut State) {
    if state.tags.contains(&identifier.declaration_id) {
        identifier.promote_temporary_jsx_tag();
    } else {
        identifier.promote_temporary();
    }
    state.promoted.insert(identifier.declaration_id);
}

// ---- Phase 1: CollectPromotableTemporaries ----

fn collect_block(block: &ReactiveBlock, state: &mut State, active_scopes: &mut Vec<ScopeId>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instruction) => {
                collect_instruction(instruction, state, active_scopes)
            }
            ReactiveStatement::Scope(scope) => {
                active_scopes.push(scope.scope.id);
                collect_block(&scope.instructions, state, active_scopes);
                active_scopes.pop();
            }
            ReactiveStatement::PrunedScope(scope) => {
                for (_, decl) in &scope.scope.declarations {
                    state.pruned.insert(
                        decl.identifier.declaration_id,
                        PrunedPlace {
                            active_scopes: active_scopes.clone(),
                            used_outside_scope: false,
                        },
                    );
                }
                collect_block(&scope.instructions, state, active_scopes);
            }
            ReactiveStatement::Terminal(stmt) => {
                collect_terminal(&stmt.terminal, state, active_scopes)
            }
        }
    }
}

fn collect_instruction(
    instruction: &ReactiveInstruction,
    state: &mut State,
    active_scopes: &mut Vec<ScopeId>,
) {
    // `traverseInstruction` then `visitValue` (which records JSX tags).
    collect_value(&instruction.value, state, active_scopes);
}

fn collect_value(value: &ReactiveValue, state: &mut State, active_scopes: &mut Vec<ScopeId>) {
    // `traverseValue`: recurse into sequence members + visit each operand place.
    if let ReactiveValue::Sequence(seq) = value {
        for instr in &seq.instructions {
            collect_instruction(instr, state, active_scopes);
        }
    }
    for place in each_reactive_value_operand(value) {
        collect_place(place, state, active_scopes);
    }
    // `visitValue`: a JSX element whose tag is an Identifier marks that tag.
    if let ReactiveValue::Instruction(instr_value) = value {
        if let InstructionValue::JsxExpression {
            tag: JsxTag::Place(tag),
            ..
        } = instr_value.as_ref()
        {
            state.tags.insert(tag.identifier.declaration_id);
        }
    }
}

/// `CollectPromotableTemporaries.visitPlace`: mark a pruned declaration used
/// outside its pruned scope.
fn collect_place(place: &Place, state: &mut State, active_scopes: &[ScopeId]) {
    if active_scopes.is_empty() {
        return;
    }
    if let Some(pruned) = state.pruned.get_mut(&place.identifier.declaration_id) {
        let top = active_scopes.last().copied();
        if top.is_some_and(|s| !pruned.active_scopes.contains(&s)) {
            pruned.used_outside_scope = true;
        }
    }
}

fn collect_terminal(
    terminal: &ReactiveTerminal,
    state: &mut State,
    active_scopes: &mut Vec<ScopeId>,
) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            collect_place(value, state, active_scopes)
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            collect_value(init, state, active_scopes);
            collect_value(test, state, active_scopes);
            collect_block(loop_, state, active_scopes);
            if let Some(update) = update {
                collect_value(update, state, active_scopes);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            collect_value(init, state, active_scopes);
            collect_value(test, state, active_scopes);
            collect_block(loop_, state, active_scopes);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            collect_value(init, state, active_scopes);
            collect_block(loop_, state, active_scopes);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            collect_block(loop_, state, active_scopes);
            collect_value(test, state, active_scopes);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            collect_value(test, state, active_scopes);
            collect_block(loop_, state, active_scopes);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            collect_place(test, state, active_scopes);
            collect_block(consequent, state, active_scopes);
            if let Some(alternate) = alternate {
                collect_block(alternate, state, active_scopes);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            collect_place(test, state, active_scopes);
            for case in cases {
                if let Some(case_test) = &case.test {
                    collect_place(case_test, state, active_scopes);
                }
                if let Some(block) = &case.block {
                    collect_block(block, state, active_scopes);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => collect_block(block, state, active_scopes),
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            collect_block(block, state, active_scopes);
            if let Some(binding) = handler_binding {
                collect_place(binding, state, active_scopes);
            }
            collect_block(handler, state, active_scopes);
        }
    }
}

// ---- Phase 2: PromoteTemporaries ----

fn promote_block(block: &mut ReactiveBlock, state: &mut State) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => promote_instruction(instruction, state),
            ReactiveStatement::Scope(scope) => {
                for dep in scope.scope.dependencies.iter_mut() {
                    if dep.identifier.name.is_none() {
                        promote_identifier(&mut dep.identifier, state);
                    }
                }
                for (_, decl) in scope.scope.declarations.iter_mut() {
                    if decl.identifier.name.is_none() {
                        promote_identifier(&mut decl.identifier, state);
                    }
                }
                promote_block(&mut scope.instructions, state);
            }
            ReactiveStatement::PrunedScope(scope) => {
                for (_, decl) in scope.scope.declarations.iter_mut() {
                    let used = state
                        .pruned
                        .get(&decl.identifier.declaration_id)
                        .is_some_and(|p| p.used_outside_scope);
                    if decl.identifier.name.is_none() && used {
                        promote_identifier(&mut decl.identifier, state);
                    }
                }
                promote_block(&mut scope.instructions, state);
            }
            ReactiveStatement::Terminal(stmt) => promote_terminal(&mut stmt.terminal, state),
        }
    }
}

fn promote_instruction(instruction: &mut ReactiveInstruction, state: &mut State) {
    promote_value(&mut instruction.value, state);
}

fn promote_value(value: &mut ReactiveValue, state: &mut State) {
    if let ReactiveValue::Sequence(seq) = value {
        for instr in seq.instructions.iter_mut() {
            promote_instruction(instr, state);
        }
        promote_value(&mut seq.value, state);
        return;
    }
    match value {
        ReactiveValue::Logical(logical) => {
            promote_value(&mut logical.left, state);
            promote_value(&mut logical.right, state);
        }
        ReactiveValue::Ternary(ternary) => {
            promote_value(&mut ternary.test, state);
            promote_value(&mut ternary.consequent, state);
            promote_value(&mut ternary.alternate, state);
        }
        ReactiveValue::OptionalCall(optional) => {
            promote_value(&mut optional.value, state);
        }
        ReactiveValue::Instruction(_) | ReactiveValue::Sequence(_) => {}
    }
}

fn promote_terminal(terminal: &mut ReactiveTerminal, state: &mut State) {
    for_each_terminal_value_mut(terminal, state, promote_value, promote_block);
}

// ---- Phase 3: PromoteInterposedTemporaries ----

struct InterState<'a> {
    promotable: &'a mut State,
    consts: HashSet<IdentifierId>,
    globals: HashSet<IdentifierId>,
    /// `id -> (identifier copy, needs_promotion)`. The identifier copy is only used
    /// to read its declaration id when promoting; promotion is applied to the live
    /// tree in phase 4.
    seen: HashMap<IdentifierId, (Identifier, bool)>,
}

fn interpose_block(block: &mut ReactiveBlock, state: &mut InterState) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => {
                interpose_instruction(instruction, state)
            }
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                interpose_block(&mut scope.instructions, state)
            }
            ReactiveStatement::Terminal(stmt) => interpose_terminal(&mut stmt.terminal, state),
        }
    }
}

/// `visitPlace`: promote a previously-seen temporary marked as needing promotion.
fn interpose_visit_place(place: &mut Place, state: &mut InterState) {
    if let Some((identifier, needs_promotion)) = state.seen.get(&place.identifier.id) {
        if *needs_promotion
            && identifier.name.is_none()
            && !state.consts.contains(&identifier.id)
            && place.identifier.name.is_none()
        {
            promote_identifier(&mut place.identifier, state.promotable);
        }
    }
}

fn interpose_visit_value_places(value: &mut ReactiveValue, state: &mut InterState) {
    // Mirror `traverseValue`: recurse into compound/sequence members, then visit
    // each base-value operand place.
    match value {
        ReactiveValue::Sequence(seq) => {
            for instr in seq.instructions.iter_mut() {
                interpose_instruction(instr, state);
            }
            interpose_visit_value_places(&mut seq.value, state);
        }
        ReactiveValue::Logical(logical) => {
            interpose_visit_value_places(&mut logical.left, state);
            interpose_visit_value_places(&mut logical.right, state);
        }
        ReactiveValue::Ternary(ternary) => {
            interpose_visit_value_places(&mut ternary.test, state);
            interpose_visit_value_places(&mut ternary.consequent, state);
            interpose_visit_value_places(&mut ternary.alternate, state);
        }
        ReactiveValue::OptionalCall(optional) => {
            interpose_visit_value_places(&mut optional.value, state);
        }
        ReactiveValue::Instruction(instr_value) => {
            for place in crate::passes::cfg::each_instruction_value_operand_mut(instr_value) {
                interpose_visit_place(place, state);
            }
        }
    }
}

fn interpose_instruction(instruction: &mut ReactiveInstruction, state: &mut InterState) {
    // The TS classifies by `instruction.value.kind`. We only need to model the
    // const-tracking + interposition marking that affects which temporaries get
    // promoted. Collect the relevant ids before the operand visit.
    let lvalue_id = instruction.lvalue.as_ref().map(|p| p.identifier.id);
    // TS reads `instruction.lvalue.identifier.name != null` on the *shared*
    // identifier object, so by phase 3 a lvalue whose scope-declaration was
    // promoted in phase 2 already reads as named. In our model each `Place` carries
    // a *cloned* identifier, so the instruction lvalue's `name` is not updated until
    // the phase-4 sweep — it still reads `None` here even though its declaration was
    // promoted. Consult the `promoted` set (keyed by declarationId, shared with the
    // scope declarations) so the "this instruction is emitted as a statement" check
    // matches TS: a promoted-lvalue instruction interposes just like a named one.
    let lvalue_named = instruction.lvalue.as_ref().is_some_and(|p| {
        p.identifier.name.is_some()
            || state
                .promotable
                .promoted
                .contains(&p.identifier.declaration_id)
    });

    enum Kind {
        StatementLike { const_store: bool },
        DeclareConst,
        DeclareOther,
        Load { source_id: IdentifierId, source_const: bool },
        PropertyLoad { object_id: IdentifierId },
        LoadGlobal,
        Other,
    }

    let kind = if let ReactiveValue::Instruction(value) = &instruction.value {
        match value.as_ref() {
            InstructionValue::CallExpression { .. }
            | InstructionValue::MethodCall { .. }
            | InstructionValue::Await { .. }
            | InstructionValue::PropertyStore { .. }
            | InstructionValue::PropertyDelete { .. }
            | InstructionValue::ComputedStore { .. }
            | InstructionValue::ComputedDelete { .. }
            | InstructionValue::PostfixUpdate { .. }
            | InstructionValue::PrefixUpdate { .. }
            | InstructionValue::StoreLocal { .. }
            | InstructionValue::StoreContext { .. }
            | InstructionValue::StoreGlobal { .. }
            | InstructionValue::Destructure { .. } => {
                let mut const_store = false;
                match value.as_ref() {
                    InstructionValue::StoreContext { kind, place, .. }
                        if matches!(kind, InstructionKind::Const | InstructionKind::HoistedConst) =>
                    {
                        state.consts.insert(place.identifier.id);
                        const_store = true;
                    }
                    InstructionValue::StoreLocal { lvalue, .. }
                        if matches!(
                            lvalue.kind,
                            InstructionKind::Const | InstructionKind::HoistedConst
                        ) =>
                    {
                        state.consts.insert(lvalue.place.identifier.id);
                        const_store = true;
                    }
                    InstructionValue::Destructure { lvalue, .. }
                        if matches!(
                            lvalue.kind,
                            InstructionKind::Const | InstructionKind::HoistedConst
                        ) =>
                    {
                        for place in pattern_operands(&lvalue.pattern) {
                            state.consts.insert(place.identifier.id);
                        }
                        const_store = true;
                    }
                    InstructionValue::MethodCall { property, .. } => {
                        state.consts.insert(property.identifier.id);
                    }
                    _ => {}
                }
                Kind::StatementLike { const_store }
            }
            InstructionValue::DeclareContext { kind, place, .. } => {
                if matches!(kind, InstructionKind::HoistedConst) {
                    state.consts.insert(place.identifier.id);
                }
                Kind::DeclareConst
            }
            InstructionValue::DeclareLocal { lvalue, .. } => {
                if matches!(lvalue.kind, InstructionKind::Const | InstructionKind::HoistedConst) {
                    state.consts.insert(lvalue.place.identifier.id);
                }
                Kind::DeclareOther
            }
            InstructionValue::LoadContext { place, .. }
            | InstructionValue::LoadLocal { place, .. } => Kind::Load {
                source_id: place.identifier.id,
                source_const: state.consts.contains(&place.identifier.id),
            },
            InstructionValue::PropertyLoad { object, .. }
            | InstructionValue::ComputedLoad { object, .. } => Kind::PropertyLoad {
                object_id: object.identifier.id,
            },
            InstructionValue::LoadGlobal { .. } => Kind::LoadGlobal,
            _ => Kind::Other,
        }
    } else {
        Kind::Other
    };

    match kind {
        Kind::StatementLike { const_store } => {
            interpose_visit_value_places(&mut instruction.value, state);
            if !const_store && (lvalue_id.is_none() || lvalue_named) {
                // This instruction will be emitted as a statement; mark all prior
                // temporaries as needing promotion.
                for (_, entry) in state.seen.iter_mut() {
                    entry.1 = true;
                }
            }
            if let Some(id) = lvalue_id {
                if !lvalue_named {
                    let identifier = instruction.lvalue.as_ref().unwrap().identifier.clone();
                    state.seen.insert(id, (identifier, false));
                }
            }
        }
        Kind::DeclareConst | Kind::DeclareOther => {
            interpose_visit_value_places(&mut instruction.value, state);
        }
        Kind::Load {
            source_id,
            source_const,
        } => {
            if let Some(id) = lvalue_id {
                if !lvalue_named {
                    if source_const || state.consts.contains(&source_id) {
                        state.consts.insert(id);
                    }
                    let identifier = instruction.lvalue.as_ref().unwrap().identifier.clone();
                    state.seen.insert(id, (identifier, false));
                }
            }
            interpose_visit_value_places(&mut instruction.value, state);
        }
        Kind::PropertyLoad { object_id } => {
            if let Some(id) = lvalue_id {
                if state.globals.contains(&object_id) {
                    state.globals.insert(id);
                    state.consts.insert(id);
                }
                if !lvalue_named {
                    let identifier = instruction.lvalue.as_ref().unwrap().identifier.clone();
                    state.seen.insert(id, (identifier, false));
                }
            }
            interpose_visit_value_places(&mut instruction.value, state);
        }
        Kind::LoadGlobal => {
            if let Some(id) = lvalue_id {
                state.globals.insert(id);
            }
            interpose_visit_value_places(&mut instruction.value, state);
        }
        Kind::Other => {
            interpose_visit_value_places(&mut instruction.value, state);
        }
    }
}

/// Phase-3 terminal traversal in the *exact* `traverseTerminal` order
/// (`ReactiveScopes/visitors.ts`). This must NOT visit branch blocks before the
/// `if`/`switch` test place: visiting a branch block first can flip the test
/// temporary's `needs_promotion` flag (via a statement-like instruction inside
/// the branch), causing the test place to be over-promoted when it is then
/// visited. The TS visits `visitPlace(test)` first, then the blocks, so the test
/// place is consumed while still un-flagged. We therefore hand-order each
/// terminal kind here rather than reusing `for_each_terminal_value_mut` (which
/// visits blocks before the separately-handled test place).
fn interpose_terminal(terminal: &mut ReactiveTerminal, state: &mut InterState) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            interpose_visit_place(value, state);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            interpose_visit_value_places(init, state);
            interpose_visit_value_places(test, state);
            interpose_block(loop_, state);
            if let Some(update) = update {
                interpose_visit_value_places(update, state);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            interpose_visit_value_places(init, state);
            interpose_visit_value_places(test, state);
            interpose_block(loop_, state);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            interpose_visit_value_places(init, state);
            interpose_block(loop_, state);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            interpose_block(loop_, state);
            interpose_visit_value_places(test, state);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            interpose_visit_value_places(test, state);
            interpose_block(loop_, state);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            // TEST first, then branch blocks (matches `traverseTerminal`).
            interpose_visit_place(test, state);
            interpose_block(consequent, state);
            if let Some(alternate) = alternate {
                interpose_block(alternate, state);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            interpose_visit_place(test, state);
            for case in cases {
                if let Some(case_test) = &mut case.test {
                    interpose_visit_place(case_test, state);
                }
                if let Some(block) = &mut case.block {
                    interpose_block(block, state);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => interpose_block(block, state),
        ReactiveTerminal::Try { block, handler, .. } => {
            interpose_block(block, state);
            interpose_block(handler, state);
        }
    }
}

// ---- Phase 4: PromoteAllInstancedOfPromotedTemporaries ----

fn sweep_block(block: &mut ReactiveBlock, state: &mut State) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => sweep_instruction(instruction, state),
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                // `traverseScope`/`traversePrunedScope` (body) then scope identifiers.
                sweep_block(&mut scope.instructions, state);
                for (_, decl) in scope.scope.declarations.iter_mut() {
                    sweep_identifier(&mut decl.identifier, state);
                }
                for dep in scope.scope.dependencies.iter_mut() {
                    sweep_identifier(&mut dep.identifier, state);
                }
                for reassign in scope.scope.reassignments.iter_mut() {
                    sweep_identifier(reassign, state);
                }
            }
            ReactiveStatement::Terminal(stmt) => sweep_terminal(&mut stmt.terminal, state),
        }
    }
}

fn sweep_identifier(identifier: &mut Identifier, state: &mut State) {
    if identifier.name.is_none() && state.promoted.contains(&identifier.declaration_id) {
        promote_identifier(identifier, state);
    }
}

fn sweep_place(place: &mut Place, state: &mut State) {
    sweep_identifier(&mut place.identifier, state);
}

fn sweep_instruction(instruction: &mut ReactiveInstruction, state: &mut State) {
    if let Some(lvalue) = &mut instruction.lvalue {
        sweep_place(lvalue, state);
    }
    sweep_value(&mut instruction.value, state);
}

fn sweep_value(value: &mut ReactiveValue, state: &mut State) {
    match value {
        ReactiveValue::Sequence(seq) => {
            for instr in seq.instructions.iter_mut() {
                sweep_instruction(instr, state);
            }
            sweep_value(&mut seq.value, state);
        }
        ReactiveValue::Logical(logical) => {
            sweep_value(&mut logical.left, state);
            sweep_value(&mut logical.right, state);
        }
        ReactiveValue::Ternary(ternary) => {
            sweep_value(&mut ternary.test, state);
            sweep_value(&mut ternary.consequent, state);
            sweep_value(&mut ternary.alternate, state);
        }
        ReactiveValue::OptionalCall(optional) => {
            sweep_value(&mut optional.value, state);
        }
        ReactiveValue::Instruction(instr_value) => {
            // `visitLValue` then `visitPlace` operands (both call `visitPlace`).
            for place in crate::passes::cfg::each_instruction_value_lvalue_mut(instr_value) {
                sweep_place(place, state);
            }
            for place in crate::passes::cfg::each_instruction_value_operand_mut(instr_value) {
                sweep_place(place, state);
            }
        }
    }
}

fn sweep_terminal(terminal: &mut ReactiveTerminal, state: &mut State) {
    for_each_terminal_value_mut(terminal, state, sweep_value, sweep_block);
    match terminal {
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            sweep_place(value, state)
        }
        ReactiveTerminal::If { test, .. } => sweep_place(test, state),
        ReactiveTerminal::Switch { test, cases, .. } => {
            sweep_place(test, state);
            for case in cases {
                if let Some(case_test) = &mut case.test {
                    sweep_place(case_test, state);
                }
            }
        }
        ReactiveTerminal::Try {
            handler_binding: Some(binding),
            ..
        } => sweep_place(binding, state),
        _ => {}
    }
}

// ---- shared terminal traversal helpers ----

/// Apply `on_value` to each compound [`ReactiveValue`] a terminal carries and
/// `on_block` to each nested block, in the visitor's traversal order, threading a
/// shared `state` through both callbacks (so the two callbacks need not both
/// borrow it simultaneously).
fn for_each_terminal_value_mut<S>(
    terminal: &mut ReactiveTerminal,
    state: &mut S,
    on_value: fn(&mut ReactiveValue, &mut S),
    on_block: fn(&mut ReactiveBlock, &mut S),
) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            on_value(init, state);
            on_value(test, state);
            on_block(loop_, state);
            if let Some(update) = update {
                on_value(update, state);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            on_value(init, state);
            on_value(test, state);
            on_block(loop_, state);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            on_value(init, state);
            on_block(loop_, state);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            on_block(loop_, state);
            on_value(test, state);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            on_value(test, state);
            on_block(loop_, state);
        }
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            on_block(consequent, state);
            if let Some(alternate) = alternate {
                on_block(alternate, state);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    on_block(block, state);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => on_block(block, state),
        ReactiveTerminal::Try { block, handler, .. } => {
            on_block(block, state);
            on_block(handler, state);
        }
    }
}

/// `eachPatternOperand`: the bound places of a destructuring pattern.
fn pattern_operands(pattern: &crate::hir::value::Pattern) -> Vec<&Place> {
    use crate::hir::value::{ArrayPatternItem, ObjectPatternProperty, Pattern};
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
