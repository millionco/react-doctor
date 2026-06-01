//! `validatePreservedManualMemoization`
//! (`Validation/ValidatePreservedManualMemoization.ts`).
//!
//! Validates that all explicit manual memoization (useMemo/useCallback) was
//! accurately preserved, and that no originally-memoized value became unmemoized
//! in the output. The TS records a `PreserveManualMemo` diagnostic on `env` for
//! each failure; `runReactiveCompilerPipeline` then returns `Err(env.aggregateErrors())`
//! if `env.hasErrors()` (`Pipeline.ts:527`). We instead return `true` from this
//! pass when any error would be recorded, so the caller (`build_reactive`) can map
//! it to a recoverable verbatim bailout under `@panicThreshold:"none"` (the
//! `handleError` path).
//!
//! Gating: run when `enablePreserveExistingMemoizationGuarantees ||
//! validatePreserveExistingMemoizationGuarantees` (`Pipeline.ts:498-503`). The
//! harness sets `validatePreserveExistingMemoizationGuarantees` from the first-line
//! pragma (default `false`), so this only runs under
//! `@enablePreserveExistingMemoizationGuarantees` (default true) or the
//! `@validatePreserveExistingMemoizationGuarantees` pragma.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{DeclarationId, IdentifierId, ScopeId};
use crate::hir::place::{Identifier, IdentifierName};
use crate::hir::value::{
    InstructionKind, InstructionValue, ManualMemoDependency, MemoDependencyRoot,
    PropertyLiteral,
};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};

use crate::passes::drop_manual_memoization::collect_maybe_memo_dependencies;

/// `compareDeps` result kinds (`CompareDependencyResult`).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum CompareDependencyResult {
    Ok = 0,
    RootDifference = 1,
    PathDifference = 2,
    Subpath = 3,
    RefAccessDifference = 4,
}

/// Whether a property path entry is the literal `current` (the ref-access guard).
fn property_is_current(prop: &PropertyLiteral) -> bool {
    matches!(prop, PropertyLiteral::String(s) if s == "current")
}

/// `compareDeps(inferred, source)`.
fn compare_deps(
    inferred: &ManualMemoDependency,
    source: &ManualMemoDependency,
) -> CompareDependencyResult {
    let roots_equal = match (&inferred.root, &source.root) {
        (
            MemoDependencyRoot::Global {
                identifier_name: a,
            },
            MemoDependencyRoot::Global {
                identifier_name: b,
            },
        ) => a == b,
        (
            MemoDependencyRoot::NamedLocal { value: a, .. },
            MemoDependencyRoot::NamedLocal { value: b, .. },
        ) => a.identifier.id == b.identifier.id,
        _ => false,
    };
    if !roots_equal {
        return CompareDependencyResult::RootDifference;
    }

    let mut is_subpath = true;
    let min_len = inferred.path.len().min(source.path.len());
    for i in 0..min_len {
        if inferred.path[i].property != source.path[i].property {
            is_subpath = false;
            break;
        } else if inferred.path[i].optional != source.path[i].optional {
            // The inferred path must be at least as precise as the manual path: if
            // the inferred path is optional, then the source path must have been
            // optional too.
            return CompareDependencyResult::PathDifference;
        }
    }

    let has_current = |dep: &ManualMemoDependency| {
        dep.path
            .iter()
            .any(|token| property_is_current(&token.property))
    };

    if is_subpath
        && (source.path.len() == inferred.path.len()
            || (inferred.path.len() >= source.path.len() && !has_current(inferred)))
    {
        CompareDependencyResult::Ok
    } else if is_subpath {
        if has_current(source) || has_current(inferred) {
            CompareDependencyResult::RefAccessDifference
        } else {
            CompareDependencyResult::Subpath
        }
    } else {
        CompareDependencyResult::PathDifference
    }
}

/// Per-`StartMemoize`/`FinishMemoize` block state (`ManualMemoBlockState`).
struct ManualMemoBlockState {
    /// Tracks reassigned temporaries (`reassignments`), keyed by declarationId.
    reassignments: HashMap<DeclarationId, Vec<Identifier>>,
    /// Declarations produced within the manual-memo block (`decls`).
    decls: HashSet<DeclarationId>,
    /// Normalized depslist from the useMemo/useCallback callsite (`depsFromSource`).
    deps_from_source: Option<Vec<ManualMemoDependency>>,
    /// The `manualMemoId` of the matching `StartMemoize`.
    manual_memo_id: u32,
}

/// The mutable validation state (`Visitor` fields + `VisitorState`).
struct Validator {
    /// Completed scopes, in evaluation order (`scopes`).
    scopes: HashSet<ScopeId>,
    /// Pruned scopes (`prunedScopes`).
    pruned_scopes: HashSet<ScopeId>,
    /// Normalized temporaries (`temporaries`).
    temporaries: HashMap<IdentifierId, ManualMemoDependency>,
    /// The active manual-memo block, or `None`.
    manual_memo_state: Option<ManualMemoBlockState>,
    /// Set to `true` if any `PreserveManualMemo` diagnostic would be recorded.
    has_error: bool,
}

fn is_named(identifier: &Identifier) -> bool {
    matches!(&identifier.name, Some(IdentifierName::Named { .. }))
}

impl Validator {
    fn new() -> Self {
        Validator {
            scopes: HashSet::new(),
            pruned_scopes: HashSet::new(),
            temporaries: HashMap::new(),
            manual_memo_state: None,
            has_error: false,
        }
    }

    /// `recordDepsInValue(value, state)` — recursively visit values + instructions
    /// to collect declarations and property loads.
    fn record_deps_in_value(&mut self, value: &ReactiveValue) {
        match value {
            ReactiveValue::Sequence(seq) => {
                for instr in &seq.instructions {
                    self.visit_instruction(instr);
                }
                self.record_deps_in_value(&seq.value);
            }
            ReactiveValue::OptionalCall(opt) => {
                self.record_deps_in_value(&opt.value);
            }
            ReactiveValue::Ternary(t) => {
                // `ConditionalExpression`: test/consequent/alternate.
                self.record_deps_in_value(&t.test);
                self.record_deps_in_value(&t.consequent);
                self.record_deps_in_value(&t.alternate);
            }
            ReactiveValue::Logical(l) => {
                self.record_deps_in_value(&l.left);
                self.record_deps_in_value(&l.right);
            }
            ReactiveValue::Instruction(instr_value) => {
                collect_maybe_memo_dependencies(instr_value, &mut self.temporaries, false);
                // `eachInstructionValueLValue` yields the stored-to place for
                // `StoreLocal`/`StoreContext`/`Destructure`. The TS records each as a
                // memo-block decl + a named temporary.
                let mut store_targets: Vec<crate::hir::place::Place> = Vec::new();
                match instr_value.as_ref() {
                    InstructionValue::StoreLocal { lvalue, .. } => {
                        store_targets.push(lvalue.place.clone());
                    }
                    InstructionValue::StoreContext { place, .. } => {
                        store_targets.push(place.clone());
                    }
                    InstructionValue::Destructure { lvalue, .. } => {
                        store_targets = lvalue_pattern_places(lvalue);
                    }
                    _ => {}
                }
                for store_target in &store_targets {
                    if let Some(state) = self.manual_memo_state.as_mut() {
                        state.decls.insert(store_target.identifier.declaration_id);
                    }
                    if is_named(&store_target.identifier) {
                        self.temporaries.insert(
                            store_target.identifier.id,
                            ManualMemoDependency {
                                root: MemoDependencyRoot::NamedLocal {
                                    value: store_target.clone(),
                                    constant: false,
                                },
                                path: Vec::new(),
                                loc: store_target.loc.clone(),
                            },
                        );
                    }
                }
            }
        }
    }

    /// `recordTemporaries(instr, state)`.
    fn record_temporaries(&mut self, instr: &ReactiveInstruction) {
        let lval_id = instr.lvalue.as_ref().map(|l| l.identifier.id);
        if let Some(id) = lval_id {
            if self.temporaries.contains_key(&id) {
                return;
            }
        }
        let is_named_local = instr
            .lvalue
            .as_ref()
            .is_some_and(|l| is_named(&l.identifier));
        if let Some(lvalue) = &instr.lvalue {
            if is_named_local && self.manual_memo_state.is_some() {
                self.manual_memo_state
                    .as_mut()
                    .unwrap()
                    .decls
                    .insert(lvalue.identifier.declaration_id);
            }
        }

        self.record_deps_in_value(&instr.value);
        if let Some(lvalue) = &instr.lvalue {
            self.temporaries.insert(
                lvalue.identifier.id,
                ManualMemoDependency {
                    root: MemoDependencyRoot::NamedLocal {
                        value: lvalue.clone(),
                        constant: false,
                    },
                    path: Vec::new(),
                    loc: lvalue.loc.clone(),
                },
            );
        }
    }

    /// `visitInstruction(instruction, state)`.
    fn visit_instruction(&mut self, instr: &ReactiveInstruction) {
        // `recordDepsInValue` recursively visits nested instructions, so we do not
        // separately traverse them.
        self.record_temporaries(instr);

        // Track reassignments from inlining of manual memo.
        if let ReactiveValue::Instruction(boxed) = &instr.value {
            if let InstructionValue::StoreLocal { lvalue, value, .. } = boxed.as_ref() {
                if lvalue.kind == InstructionKind::Reassign && self.manual_memo_state.is_some() {
                    let decl = lvalue.place.identifier.declaration_id;
                    self.manual_memo_state
                        .as_mut()
                        .unwrap()
                        .reassignments
                        .entry(decl)
                        .or_default()
                        .push(value.identifier.clone());
                }
            }
            // Simpler cases of inlining assign to the original IIFE lvalue: a
            // `LoadLocal` of a scoped place into an unscoped lvalue.
            if let InstructionValue::LoadLocal { place, .. } = boxed.as_ref() {
                if place.identifier.scope.is_some()
                    && instr
                        .lvalue
                        .as_ref()
                        .is_some_and(|l| l.identifier.scope.is_none())
                    && self.manual_memo_state.is_some()
                {
                    let decl = instr.lvalue.as_ref().unwrap().identifier.declaration_id;
                    self.manual_memo_state
                        .as_mut()
                        .unwrap()
                        .reassignments
                        .entry(decl)
                        .or_default()
                        .push(place.identifier.clone());
                }
            }
        }

        if let ReactiveValue::Instruction(boxed) = &instr.value {
            match boxed.as_ref() {
                InstructionValue::StartMemoize {
                    manual_memo_id,
                    deps,
                    has_invalid_deps,
                    ..
                } => {
                    // `Unexpected nested StartMemoize` is an invariant in the TS;
                    // we tolerate it (no panic) by simply overwriting.
                    if *has_invalid_deps {
                        // ValidateExhaustiveDependencies already reported an error,
                        // skip to avoid duplicate errors.
                        return;
                    }
                    self.manual_memo_state = Some(ManualMemoBlockState {
                        reassignments: HashMap::new(),
                        decls: HashSet::new(),
                        deps_from_source: deps.clone(),
                        manual_memo_id: *manual_memo_id,
                    });

                    // Each StartMemoize operand (its NamedLocal deps) must either be
                    // non-scoped or its scope must have completed before the useMemo.
                    if let Some(deps) = deps {
                        for dep in deps {
                            if let MemoDependencyRoot::NamedLocal { value, .. } = &dep.root {
                                let identifier = &value.identifier;
                                if let Some(scope) = identifier.scope {
                                    if !self.scopes.contains(&scope)
                                        && !self.pruned_scopes.contains(&scope)
                                    {
                                        // "This dependency may be modified later".
                                        self.has_error = true;
                                    }
                                }
                            }
                        }
                    }
                }
                InstructionValue::FinishMemoize {
                    manual_memo_id,
                    decl,
                    pruned,
                    ..
                } => {
                    let Some(state) = self.manual_memo_state.take() else {
                        // StartMemoize had invalid deps, skip validation.
                        return;
                    };
                    if state.manual_memo_id != *manual_memo_id {
                        // Mismatch is an invariant in the TS; tolerate it.
                        return;
                    }
                    if *pruned {
                        return;
                    }
                    let identifier = &decl.identifier;
                    let decls: Vec<Identifier> = if identifier.scope.is_none() {
                        // If the manual memo was a useMemo that got inlined, iterate
                        // through all reassignments to the iife temporary.
                        state
                            .reassignments
                            .get(&identifier.declaration_id)
                            .cloned()
                            .unwrap_or_else(|| vec![identifier.clone()])
                    } else {
                        vec![identifier.clone()]
                    };
                    for id in &decls {
                        if is_unmemoized(id, &self.scopes) {
                            // "This value was memoized in source but not in
                            // compilation output".
                            self.has_error = true;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// `visitScope(scopeBlock, state)`.
    fn visit_scope(&mut self, scope_block: &ReactiveScopeBlock) {
        // `traverseScope` first (visit the inner statements).
        self.visit_block(&scope_block.instructions);

        if let Some(state) = &self.manual_memo_state {
            if let Some(deps_from_source) = &state.deps_from_source {
                let decls = state.decls.clone();
                let deps_from_source = deps_from_source.clone();
                for dep in &scope_block.scope.dependencies {
                    self.validate_inferred_dep(dep, &decls, &deps_from_source);
                }
            }
        }

        self.scopes.insert(scope_block.scope.id);
        for id in &scope_block.scope.merged {
            self.scopes.insert(*id);
        }
    }

    /// `validateInferredDep(dep, temporaries, declsWithinMemoBlock, validDeps, ...)`.
    fn validate_inferred_dep(
        &mut self,
        dep: &crate::hir::terminal::ReactiveScopeDependency,
        decls_within_memo_block: &HashSet<DeclarationId>,
        valid_deps_in_memo_block: &[ManualMemoDependency],
    ) {
        let normalized_dep: ManualMemoDependency =
            if let Some(maybe_root) = self.temporaries.get(&dep.identifier.id) {
                let mut path = maybe_root.path.clone();
                path.extend(dep.path.iter().cloned());
                ManualMemoDependency {
                    root: maybe_root.root.clone(),
                    path,
                    loc: maybe_root.loc.clone(),
                }
            } else {
                // The TS invariants that the scope dependency is named here; if it
                // is not, we conservatively skip (no error) rather than panic.
                if !is_named(&dep.identifier) {
                    return;
                }
                ManualMemoDependency {
                    root: MemoDependencyRoot::NamedLocal {
                        value: crate::hir::place::Place {
                            identifier: dep.identifier.clone(),
                            effect: crate::hir::place::Effect::Read,
                            reactive: false,
                            loc: dep.loc.clone(),
                        },
                        constant: false,
                    },
                    path: dep.path.clone(),
                    loc: dep.loc.clone(),
                }
            };

        // A dependency declared within the memo block needs no source match.
        if let MemoDependencyRoot::NamedLocal { value, .. } = &normalized_dep.root {
            if decls_within_memo_block.contains(&value.identifier.declaration_id) {
                return;
            }
        }

        for original_dep in valid_deps_in_memo_block {
            if compare_deps(&normalized_dep, original_dep) == CompareDependencyResult::Ok {
                return;
            }
        }
        // No source dependency matched the inferred dependency.
        self.has_error = true;
    }

    fn visit_block(&mut self, block: &ReactiveBlock) {
        for stmt in block {
            match stmt {
                ReactiveStatement::Instruction(instruction) => self.visit_instruction(instruction),
                ReactiveStatement::Scope(scope) => self.visit_scope(scope),
                ReactiveStatement::PrunedScope(scope) => self.visit_pruned_scope(scope),
                ReactiveStatement::Terminal(stmt) => self.visit_terminal(&stmt.terminal),
            }
        }
    }

    fn visit_pruned_scope(&mut self, scope_block: &ReactiveScopeBlock) {
        self.visit_block(&scope_block.instructions);
        self.pruned_scopes.insert(scope_block.scope.id);
    }

    fn visit_terminal(&mut self, terminal: &ReactiveTerminal) {
        match terminal {
            ReactiveTerminal::Break { .. }
            | ReactiveTerminal::Continue { .. }
            | ReactiveTerminal::Return { .. }
            | ReactiveTerminal::Throw { .. } => {}
            ReactiveTerminal::DoWhile { loop_, test, .. } => {
                self.visit_block(loop_);
                self.record_deps_in_value(test);
            }
            ReactiveTerminal::While { test, loop_, .. } => {
                self.record_deps_in_value(test);
                self.visit_block(loop_);
            }
            ReactiveTerminal::For {
                init,
                test,
                update,
                loop_,
                ..
            } => {
                self.record_deps_in_value(init);
                self.record_deps_in_value(test);
                if let Some(update) = update {
                    self.record_deps_in_value(update);
                }
                self.visit_block(loop_);
            }
            ReactiveTerminal::ForOf {
                init, test, loop_, ..
            } => {
                self.record_deps_in_value(init);
                self.record_deps_in_value(test);
                self.visit_block(loop_);
            }
            ReactiveTerminal::ForIn { init, loop_, .. } => {
                self.record_deps_in_value(init);
                self.visit_block(loop_);
            }
            ReactiveTerminal::If {
                consequent,
                alternate,
                ..
            } => {
                self.visit_block(consequent);
                if let Some(alternate) = alternate {
                    self.visit_block(alternate);
                }
            }
            ReactiveTerminal::Switch { cases, .. } => {
                for case in cases {
                    if let Some(block) = &case.block {
                        self.visit_block(block);
                    }
                }
            }
            ReactiveTerminal::Label { block, .. } => self.visit_block(block),
            ReactiveTerminal::Try { block, handler, .. } => {
                self.visit_block(block);
                self.visit_block(handler);
            }
        }
    }
}

/// `isUnmemoized(operand, scopes)`.
fn is_unmemoized(operand: &Identifier, scopes: &HashSet<ScopeId>) -> bool {
    operand.scope.is_some() && !scopes.contains(&operand.scope.unwrap())
}

/// Collect the lvalue places of a destructure pattern.
fn lvalue_pattern_places(
    pattern: &crate::hir::value::LValuePattern,
) -> Vec<crate::hir::place::Place> {
    let mut out = Vec::new();
    collect_pattern_places(&pattern.pattern, &mut out);
    out
}

fn collect_pattern_places(
    pattern: &crate::hir::value::Pattern,
    out: &mut Vec<crate::hir::place::Place>,
) {
    use crate::hir::value::{ArrayPatternItem, ObjectPatternProperty, Pattern};
    match pattern {
        Pattern::Array(arr) => {
            for item in &arr.items {
                match item {
                    ArrayPatternItem::Place(p) => out.push(p.clone()),
                    ArrayPatternItem::Spread(s) => out.push(s.place.clone()),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(obj) => {
            for prop in &obj.properties {
                match prop {
                    ObjectPatternProperty::Property(p) => out.push(p.place.clone()),
                    ObjectPatternProperty::Spread(s) => out.push(s.place.clone()),
                }
            }
        }
    }
}

/// Run `validatePreservedManualMemoization` on `fn`. Returns `true` if any
/// `PreserveManualMemo` diagnostic would be recorded (the function could not
/// preserve its existing manual memoization).
pub fn validate_preserved_manual_memoization(func: &ReactiveFunction) -> bool {
    let mut validator = Validator::new();
    validator.visit_block(&func.body);
    validator.has_error
}
