//! `mergeReactiveScopesThatInvalidateTogether`, ported from
//! `packages/react-compiler/src/ReactiveScopes/MergeReactiveScopesThatInvalidateTogether.ts`.
//!
//! Reduces memoization overhead by merging reactive scopes that always invalidate
//! together. Two cases:
//! - **Consecutive scopes** in the same reactive block, possibly separated by
//!   safe-to-memoize intermediate instructions, when they have identical
//!   dependencies *or* the outputs of the earlier scope are the inputs of the
//!   later scope (and those outputs are guaranteed to invalidate).
//! - **Nested scopes** whose dependencies are identical to the parent scope (the
//!   inner scope is flattened away).
//!
//! Two visitor passes (matching the TS):
//! 1. `FindLastUsageVisitor` records, per `DeclarationId`, the last instruction id
//!    at which it is *read* (operand / terminal operand). Keyed by `DeclarationId`
//!    for output-compatibility with the TS.
//! 2. `Transform` walks each block: it first recurses into nested blocks/scopes
//!    (flattening nested scopes with identical deps), then identifies and performs
//!    consecutive-scope merges, moving intermediate instructions into the merged
//!    scope and pruning declarations no longer live past the extended range.

use std::collections::{HashMap, HashSet};

use crate::environment::shapes::{
    BUILTIN_ARRAY_ID, BUILTIN_FUNCTION_ID, BUILTIN_JSX_ID, BUILTIN_OBJECT_ID,
};
use crate::hir::ids::{DeclarationId, IdentifierId, InstructionId};
use crate::hir::place::{Place, SourceLocation, Type};
use crate::hir::terminal::{ReactiveScope, ReactiveScopeDependency, ScopeDeclaration};
use crate::hir::value::{DependencyPathEntry, InstructionKind, InstructionValue};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};
use super::prune_non_reactive_dependencies::each_reactive_value_operand;

/// `mergeReactiveScopesThatInvalidateTogether(fn)`.
pub fn merge_reactive_scopes_that_invalidate_together(func: &mut ReactiveFunction) {
    let last_usage = find_last_usage(func);
    let mut transform = Transform {
        last_usage,
        temporaries: HashMap::new(),
    };
    transform.visit_block(&mut func.body, None);

    // In the TS, `identifier.mutableRange` and `scope.range` are the *same object*,
    // so extending a merged scope's `range.end` is immediately reflected on every
    // member identifier's printed `[a:b]`. We model this aliasing explicitly via
    // `range_scope`: after merging, write each surviving scope-block's range onto
    // every identifier whose `range_scope` matches that scope id.
    super::reactive_place::sync_scope_ranges(func);
}

// ---- pass 1: FindLastUsageVisitor ----

/// `FindLastUsageVisitor`: `lastUsage[decl]` is the max instruction id at which
/// `decl` is read as an operand. `visitPlace` is only invoked for reads (operands
/// and terminal operands), never for lvalues (the base `visitLValue` is a no-op).
fn find_last_usage(func: &ReactiveFunction) -> HashMap<DeclarationId, InstructionId> {
    let mut last_usage: HashMap<DeclarationId, InstructionId> = HashMap::new();
    last_usage_block(&func.body, &mut last_usage);
    last_usage
}

fn record_usage(
    id: InstructionId,
    place: &Place,
    last_usage: &mut HashMap<DeclarationId, InstructionId>,
) {
    let decl = place.identifier.declaration_id;
    let next = match last_usage.get(&decl) {
        Some(previous) => InstructionId::new(previous.as_u32().max(id.as_u32())),
        None => id,
    };
    last_usage.insert(decl, next);
}

fn last_usage_value(
    id: InstructionId,
    value: &ReactiveValue,
    last_usage: &mut HashMap<DeclarationId, InstructionId>,
) {
    // `traverseValue`: a `SequenceExpression`'s member instructions are visited as
    // full instructions (their own ids drive `visitPlace`); the final value uses
    // `value.id`. Other compound forms flatten through `eachReactiveValueOperand`.
    if let ReactiveValue::Sequence(seq) = value {
        for instr in &seq.instructions {
            last_usage_instruction(instr, last_usage);
        }
        last_usage_value(seq.id, &seq.value, last_usage);
        return;
    }
    for place in each_reactive_value_operand(value) {
        record_usage(id, place, last_usage);
    }
}

fn last_usage_instruction(
    instruction: &ReactiveInstruction,
    last_usage: &mut HashMap<DeclarationId, InstructionId>,
) {
    last_usage_value(instruction.id, &instruction.value, last_usage);
}

fn last_usage_terminal(
    terminal: &ReactiveTerminal,
    last_usage: &mut HashMap<DeclarationId, InstructionId>,
) {
    let id = terminal.id();
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            record_usage(id, value, last_usage);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            last_usage_value(id, init, last_usage);
            last_usage_value(id, test, last_usage);
            last_usage_block(loop_, last_usage);
            if let Some(update) = update {
                last_usage_value(id, update, last_usage);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            last_usage_value(id, init, last_usage);
            last_usage_value(id, test, last_usage);
            last_usage_block(loop_, last_usage);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            last_usage_value(id, init, last_usage);
            last_usage_block(loop_, last_usage);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            last_usage_block(loop_, last_usage);
            last_usage_value(id, test, last_usage);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            last_usage_value(id, test, last_usage);
            last_usage_block(loop_, last_usage);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            record_usage(id, test, last_usage);
            last_usage_block(consequent, last_usage);
            if let Some(alternate) = alternate {
                last_usage_block(alternate, last_usage);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            record_usage(id, test, last_usage);
            for case in cases {
                if let Some(case_test) = &case.test {
                    record_usage(id, case_test, last_usage);
                }
                if let Some(block) = &case.block {
                    last_usage_block(block, last_usage);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => last_usage_block(block, last_usage),
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            last_usage_block(block, last_usage);
            if let Some(binding) = handler_binding {
                record_usage(id, binding, last_usage);
            }
            last_usage_block(handler, last_usage);
        }
    }
}

fn last_usage_block(block: &ReactiveBlock, last_usage: &mut HashMap<DeclarationId, InstructionId>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instruction) => {
                last_usage_instruction(instruction, last_usage)
            }
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                last_usage_block(&scope.instructions, last_usage)
            }
            ReactiveStatement::Terminal(stmt) => last_usage_terminal(&stmt.terminal, last_usage),
        }
    }
}

// ---- pass 2/3: Transform ----

struct Transform {
    last_usage: HashMap<DeclarationId, InstructionId>,
    temporaries: HashMap<DeclarationId, DeclarationId>,
}

/// A pending consecutive-merge candidate (`MergedScope` in the TS).
struct MergedScope {
    /// Index into the block of the scope statement the merge accumulates into.
    from: usize,
    /// One-past the last index merged so far.
    to: usize,
    /// Declarations of intermediate instructions seen since `from`.
    lvalues: HashSet<DeclarationId>,
}

impl Transform {
    /// The overridden `visitBlock`: recurse first (flattening nested scopes), then
    /// run the consecutive-scope merge on this block.
    fn visit_block(&mut self, block: &mut ReactiveBlock, state: Option<&[ReactiveScopeDependency]>) {
        // Pass 1: visit nested blocks (flatten nested scopes with identical deps).
        self.traverse_block(block, state);

        // Pass 2: identify consecutive scopes to merge.
        let mut current: Option<MergedScope> = None;
        let mut merged: Vec<MergedScope> = Vec::new();

        for i in 0..block.len() {
            match &block[i] {
                ReactiveStatement::Terminal(_) | ReactiveStatement::PrunedScope(_) => {
                    // We don't merge across terminals or pruned scopes.
                    Self::reset(&mut current, &mut merged);
                }
                ReactiveStatement::Instruction(instruction) => {
                    match mergeable_instruction_kind(&instruction.value) {
                        IntermediateKind::Simple => {
                            if let Some(cur) = current.as_mut() {
                                if let Some(lvalue) = &instruction.lvalue {
                                    cur.lvalues.insert(lvalue.identifier.declaration_id);
                                    if let ReactiveValue::Instruction(value) = &instruction.value {
                                        if let InstructionValue::LoadLocal { place, .. } =
                                            value.as_ref()
                                        {
                                            self.temporaries.insert(
                                                lvalue.identifier.declaration_id,
                                                place.identifier.declaration_id,
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        IntermediateKind::StoreLocal => {
                            if current.is_some() {
                                let (is_const, target, source) = store_local_parts(instruction);
                                if is_const {
                                    let lvalue_decls =
                                        instruction_lvalue_declarations(instruction);
                                    let cur = current.as_mut().unwrap();
                                    for lvalue in lvalue_decls {
                                        cur.lvalues.insert(lvalue);
                                    }
                                    if let (Some(target), Some(source)) = (target, source) {
                                        let resolved = self
                                            .temporaries
                                            .get(&source)
                                            .copied()
                                            .unwrap_or(source);
                                        self.temporaries.insert(target, resolved);
                                    }
                                } else {
                                    Self::reset(&mut current, &mut merged);
                                }
                            }
                        }
                        IntermediateKind::Other => Self::reset(&mut current, &mut merged),
                    }
                }
                ReactiveStatement::Scope(_) => {
                    let can_merge = current.as_ref().is_some_and(|cur| {
                        let (ReactiveStatement::Scope(cur_block), ReactiveStatement::Scope(next)) =
                            (&block[cur.from], &block[i])
                        else {
                            return false;
                        };
                        can_merge_scopes(cur_block, next, &self.temporaries)
                            && are_lvalues_last_used_by_scope(
                                &next.scope,
                                &cur.lvalues,
                                &self.last_usage,
                            )
                    });

                    if can_merge {
                        let (next_range_end, next_decls, next_scope_id, eligible_next) = {
                            let ReactiveStatement::Scope(next) = &block[i] else {
                                unreachable!()
                            };
                            (
                                next.scope.range.end,
                                next.scope.declarations.clone(),
                                next.scope.id,
                                scope_is_eligible_for_merging(next),
                            )
                        };
                        let cur = current.as_mut().unwrap();
                        {
                            let ReactiveStatement::Scope(cur_block) = &mut block[cur.from] else {
                                unreachable!()
                            };
                            cur_block.scope.range.end = InstructionId::new(
                                cur_block
                                    .scope
                                    .range
                                    .end
                                    .as_u32()
                                    .max(next_range_end.as_u32()),
                            );
                            for (key, value) in next_decls {
                                upsert_declaration(&mut cur_block.scope, key, value);
                            }
                            update_scope_declarations(&mut cur_block.scope, &self.last_usage);
                            cur_block.scope.merged.insert(next_scope_id);
                        }
                        cur.to = i + 1;
                        cur.lvalues.clear();
                        if !eligible_next {
                            Self::reset(&mut current, &mut merged);
                        }
                    } else {
                        if current.is_some() {
                            Self::reset(&mut current, &mut merged);
                        }
                        let eligible = {
                            let ReactiveStatement::Scope(scope) = &block[i] else {
                                unreachable!()
                            };
                            scope_is_eligible_for_merging(scope)
                        };
                        if eligible {
                            current = Some(MergedScope {
                                from: i,
                                to: i + 1,
                                lvalues: HashSet::new(),
                            });
                        }
                    }
                }
            }
        }
        Self::reset(&mut current, &mut merged);

        // Pass 3: materialize merges.
        if merged.is_empty() {
            return;
        }
        let owned: Vec<ReactiveStatement> = std::mem::take(block);
        let mut owned: Vec<Option<ReactiveStatement>> = owned.into_iter().map(Some).collect();
        let mut next_instructions: Vec<ReactiveStatement> = Vec::new();
        let mut index = 0usize;

        for entry in &merged {
            while index < entry.from {
                next_instructions.push(owned[index].take().unwrap());
                index += 1;
            }
            let mut merged_scope = match owned[entry.from].take() {
                Some(ReactiveStatement::Scope(scope)) => scope,
                _ => unreachable!("merge start index must be a scope"),
            };
            index += 1;
            while index < entry.to {
                let stmt = owned[index].take().unwrap();
                index += 1;
                match stmt {
                    ReactiveStatement::Scope(inner) => {
                        // The inner scope's instructions fold into the merged scope
                        // (its `scope.merged` entry was already recorded in pass 2).
                        merged_scope.instructions.extend(inner.instructions);
                    }
                    other => merged_scope.instructions.push(other),
                }
            }
            next_instructions.push(ReactiveStatement::Scope(merged_scope));
        }
        while index < owned.len() {
            if let Some(stmt) = owned[index].take() {
                next_instructions.push(stmt);
            }
            index += 1;
        }
        *block = next_instructions;
    }

    /// `ReactiveFunctionTransform.traverseBlock`: recurse into nested scopes (with
    /// flatten), pruned scopes, terminals, and sequence members.
    fn traverse_block(
        &mut self,
        block: &mut ReactiveBlock,
        state: Option<&[ReactiveScopeDependency]>,
    ) {
        let owned: Vec<ReactiveStatement> = std::mem::take(block);
        let mut next: Vec<ReactiveStatement> = Vec::with_capacity(owned.len());
        for stmt in owned {
            match stmt {
                ReactiveStatement::Instruction(mut instruction) => {
                    self.transform_instruction(&mut instruction, state);
                    next.push(ReactiveStatement::Instruction(instruction));
                }
                ReactiveStatement::Scope(mut scope) => {
                    // `visitScope`: traverse the body with this scope's deps as the
                    // new state.
                    let deps = scope.scope.dependencies.clone();
                    self.visit_block(&mut scope.instructions, Some(&deps));
                    // Flatten a nested scope whose deps equal the enclosing scope's.
                    if let Some(state) = state {
                        if are_equal_dependencies(state, &scope.scope.dependencies) {
                            next.extend(std::mem::take(&mut scope.instructions));
                            continue;
                        }
                    }
                    next.push(ReactiveStatement::Scope(scope));
                }
                ReactiveStatement::PrunedScope(mut scope) => {
                    self.visit_block(&mut scope.instructions, state);
                    next.push(ReactiveStatement::PrunedScope(scope));
                }
                ReactiveStatement::Terminal(mut term_stmt) => {
                    self.transform_terminal(&mut term_stmt.terminal, state);
                    next.push(ReactiveStatement::Terminal(term_stmt));
                }
            }
        }
        *block = next;
    }

    fn transform_instruction(
        &mut self,
        instruction: &mut ReactiveInstruction,
        state: Option<&[ReactiveScopeDependency]>,
    ) {
        // Recurse into sequence members (merge has no per-instruction behavior
        // beyond recursing into the nested instructions a member may carry).
        if let ReactiveValue::Sequence(seq) = &mut instruction.value {
            for instr in seq.instructions.iter_mut() {
                self.transform_instruction(instr, state);
            }
        }
    }

    fn transform_terminal(
        &mut self,
        terminal: &mut ReactiveTerminal,
        state: Option<&[ReactiveScopeDependency]>,
    ) {
        match terminal {
            ReactiveTerminal::Break { .. }
            | ReactiveTerminal::Continue { .. }
            | ReactiveTerminal::Return { .. }
            | ReactiveTerminal::Throw { .. } => {}
            ReactiveTerminal::For { loop_, .. }
            | ReactiveTerminal::ForOf { loop_, .. }
            | ReactiveTerminal::ForIn { loop_, .. }
            | ReactiveTerminal::DoWhile { loop_, .. }
            | ReactiveTerminal::While { loop_, .. } => self.visit_block(loop_, state),
            ReactiveTerminal::If {
                consequent,
                alternate,
                ..
            } => {
                self.visit_block(consequent, state);
                if let Some(alternate) = alternate {
                    self.visit_block(alternate, state);
                }
            }
            ReactiveTerminal::Switch { cases, .. } => {
                for case in cases {
                    if let Some(block) = &mut case.block {
                        self.visit_block(block, state);
                    }
                }
            }
            ReactiveTerminal::Label { block, .. } => self.visit_block(block, state),
            ReactiveTerminal::Try { block, handler, .. } => {
                self.visit_block(block, state);
                self.visit_block(handler, state);
            }
        }
    }

    /// `reset()`: commit `current` to `merged` if it actually grew (`to > from + 1`).
    fn reset(current: &mut Option<MergedScope>, merged: &mut Vec<MergedScope>) {
        if let Some(cur) = current.take() {
            if cur.to > cur.from + 1 {
                merged.push(cur);
            }
        }
    }
}

/// The merge-relevant classification of an intermediate instruction value.
enum IntermediateKind {
    /// A simple value safe to make conditional.
    Simple,
    /// A `StoreLocal` (mergeable only if `Const`).
    StoreLocal,
    /// Anything else (resets the merge candidate).
    Other,
}

fn mergeable_instruction_kind(value: &ReactiveValue) -> IntermediateKind {
    let ReactiveValue::Instruction(value) = value else {
        return IntermediateKind::Other;
    };
    match value.as_ref() {
        InstructionValue::BinaryExpression { .. }
        | InstructionValue::ComputedLoad { .. }
        | InstructionValue::JsxText { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::LoadLocal { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::PropertyLoad { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::UnaryExpression { .. } => IntermediateKind::Simple,
        InstructionValue::StoreLocal { .. } => IntermediateKind::StoreLocal,
        _ => IntermediateKind::Other,
    }
}

/// `(is_const, target_decl, source_decl)` for a `StoreLocal` instruction value.
fn store_local_parts(
    instruction: &ReactiveInstruction,
) -> (bool, Option<DeclarationId>, Option<DeclarationId>) {
    if let ReactiveValue::Instruction(value) = &instruction.value {
        if let InstructionValue::StoreLocal { lvalue, value, .. } = value.as_ref() {
            return (
                lvalue.kind == InstructionKind::Const,
                Some(lvalue.place.identifier.declaration_id),
                Some(value.identifier.declaration_id),
            );
        }
    }
    (false, None, None)
}

/// `eachInstructionLValue(instr).declarationId` — the optional `instr.lvalue` plus
/// the value-carried lvalue (the StoreLocal place).
fn instruction_lvalue_declarations(instruction: &ReactiveInstruction) -> Vec<DeclarationId> {
    let mut out = Vec::new();
    if let Some(lvalue) = &instruction.lvalue {
        out.push(lvalue.identifier.declaration_id);
    }
    if let ReactiveValue::Instruction(value) = &instruction.value {
        if let InstructionValue::StoreLocal { lvalue, .. } = value.as_ref() {
            out.push(lvalue.place.identifier.declaration_id);
        }
    }
    out
}

/// `updateScopeDeclarations`: remove declarations last-used before `range.end`.
fn update_scope_declarations(
    scope: &mut ReactiveScope,
    last_usage: &HashMap<DeclarationId, InstructionId>,
) {
    let end = scope.range.end.as_u32();
    scope.declarations.retain(|(_, decl)| {
        let last_used_at = last_usage
            .get(&decl.identifier.declaration_id)
            .map(|i| i.as_u32())
            .unwrap_or(0);
        last_used_at >= end
    });
}

/// Set/replace a declaration keyed by `IdentifierId`, preserving insertion order.
fn upsert_declaration(scope: &mut ReactiveScope, key: IdentifierId, value: ScopeDeclaration) {
    if let Some(entry) = scope.declarations.iter_mut().find(|(k, _)| *k == key) {
        entry.1 = value;
    } else {
        scope.declarations.push((key, value));
    }
}

/// `areLValuesLastUsedByScope`: every lvalue's last usage is before `range.end`.
fn are_lvalues_last_used_by_scope(
    scope: &ReactiveScope,
    lvalues: &HashSet<DeclarationId>,
    last_usage: &HashMap<DeclarationId, InstructionId>,
) -> bool {
    let end = scope.range.end.as_u32();
    for lvalue in lvalues {
        let last_used_at = last_usage.get(lvalue).map(|i| i.as_u32()).unwrap_or(0);
        if last_used_at >= end {
            return false;
        }
    }
    true
}

fn can_merge_scopes(
    current: &ReactiveScopeBlock,
    next: &ReactiveScopeBlock,
    temporaries: &HashMap<DeclarationId, DeclarationId>,
) -> bool {
    // Don't merge scopes with reassignments.
    if !current.scope.reassignments.is_empty() || !next.scope.reassignments.is_empty() {
        return false;
    }
    // Identical dependencies => always invalidate together.
    if are_equal_dependencies(&current.scope.dependencies, &next.scope.dependencies) {
        return true;
    }
    // Outputs of `current` are the inputs of `next`. Either the current scope's
    // declarations (as a synthetic dependency set) equal `next`'s dependencies, or
    // every `next` dependency is a path-free always-invalidating value produced by
    // a current-scope declaration (directly or via a tracked temporary alias).
    let current_decls_as_deps: Vec<ReactiveScopeDependency> = current
        .scope
        .declarations
        .iter()
        .map(|(_, decl)| ReactiveScopeDependency {
            identifier: decl.identifier.clone(),
            reactive: true,
            path: Vec::new(),
            loc: SourceLocation::Generated,
        })
        .collect();
    if are_equal_dependencies(&current_decls_as_deps, &next.scope.dependencies) {
        return true;
    }
    if !next.scope.dependencies.is_empty()
        && next.scope.dependencies.iter().all(|dep| {
            dep.path.is_empty()
                && is_always_invalidating_type(&dep.identifier.type_)
                && current.scope.declarations.iter().any(|(_, decl)| {
                    decl.identifier.declaration_id == dep.identifier.declaration_id
                        || Some(decl.identifier.declaration_id)
                            == temporaries.get(&dep.identifier.declaration_id).copied()
                })
        })
    {
        return true;
    }
    false
}

/// `isAlwaysInvalidatingType(type)`.
pub fn is_always_invalidating_type(type_: &Type) -> bool {
    match type_ {
        Type::Object { shape_id: Some(s) } => {
            s == BUILTIN_ARRAY_ID
                || s == BUILTIN_OBJECT_ID
                || s == BUILTIN_FUNCTION_ID
                || s == BUILTIN_JSX_ID
        }
        Type::Function { .. } => true,
        _ => false,
    }
}

/// `areEqualDependencies(a, b)`: same size and every entry of `a` has a
/// declaration-id + path match in `b`.
fn are_equal_dependencies(a: &[ReactiveScopeDependency], b: &[ReactiveScopeDependency]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().all(|a_value| {
        b.iter().any(|b_value| {
            a_value.identifier.declaration_id == b_value.identifier.declaration_id
                && are_equal_paths(&a_value.path, &b_value.path)
        })
    })
}

fn are_equal_paths(a: &[DependencyPathEntry], b: &[DependencyPathEntry]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .all(|(x, y)| x.property == y.property && x.optional == y.optional)
}

/// `scopeIsEligibleForMerging`: no dependencies (never changes), or at least one
/// declaration of an always-invalidating type.
fn scope_is_eligible_for_merging(scope_block: &ReactiveScopeBlock) -> bool {
    if scope_block.scope.dependencies.is_empty() {
        return true;
    }
    scope_block
        .scope
        .declarations
        .iter()
        .any(|(_, decl)| is_always_invalidating_type(&decl.identifier.type_))
}
