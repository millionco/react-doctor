//! `propagateScopeDependenciesHIR(fn)` — port of
//! `HIR/PropagateScopeDependenciesHIR.ts` plus its supporting subsystem
//! (`CollectHoistablePropertyLoads`, `DeriveMinimalDependenciesHIR`,
//! `CollectOptionalChainDependencies`).
//!
//! This pass computes each reactive scope's reactive `dependencies` (and the
//! `declarations` / `reassignments` populated as a side effect of dependency
//! collection), printed in the scope terminal's
//! `dependencies=[...] declarations=[...] reassignments=[...]` lists.
//!
//! High-level pipeline (mirrors `propagateScopeDependenciesHIR`):
//!   1. `findTemporariesUsedOutsideDeclaringScope`
//!   2. `collectTemporariesSidemap`
//!   3. `collectOptionalChainSidemap`
//!   4. `collectHoistablePropertyLoads` keyed by scope id
//!   5. `collectDependencies` (the `DependencyCollectionContext` traversal,
//!      which also writes scope `declarations`/`reassignments`)
//!   6. per-scope minimization through `ReactiveScopeDependencyTreeHIR`
//!
//! The dependency print form is the only HIR dump that renders a
//! `printSourceLocation` as `start.line:start.column:end.line:end.column`; the
//! byte spans on the dependency `loc`s are resolved to that form by
//! `resolve_dependency_locations` (driven from `compile.rs`, which holds the
//! source text), keeping this entry point's signature source-free.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, DeclarationId, IdentifierId, InstructionId, ScopeId};
use crate::hir::model::HirFunction;
use crate::hir::place::{Identifier, Place, SourceLocation, Type};
use crate::hir::terminal::{ReactiveScope, ReactiveScopeDependency, ScopeDeclaration, Terminal};
use crate::hir::value::{
    ArrayPatternItem, DependencyPathEntry, InstructionKind, InstructionValue, ObjectPatternProperty,
    Pattern, PropertyLiteral,
};
use crate::passes::cfg::{each_instruction_value_operand, each_terminal_operand};

/// `propagateScopeDependenciesHIR(fn)`.
pub fn propagate_scope_dependencies_hir(func: &mut HirFunction) {
    let used_outside = find_temporaries_used_outside_declaring_scope(func);

    let mut temporaries: HashMap<IdentifierId, ReactiveScopeDependency> = HashMap::new();
    collect_temporaries_sidemap_impl(func, &used_outside, &mut temporaries, None);

    let optional = collect_optional_chain_sidemap(func);

    // `keyByScopeId(fn, collectHoistablePropertyLoads(fn, temporaries, hoistableObjects))`.
    let hoistable_by_block =
        collect_hoistable_property_loads(func, &temporaries, &optional.hoistable_objects);
    let hoistable_by_scope = key_by_scope_id(func, &hoistable_by_block);

    // `new Map([...temporaries, ...temporariesReadInOptional])`.
    let mut deps_temporaries = temporaries.clone();
    for (id, dep) in &optional.temporaries_read_in_optional {
        deps_temporaries.insert(*id, dep.clone());
    }

    let scope_deps = collect_dependencies(
        func,
        &used_outside,
        &deps_temporaries,
        &optional.processed_instrs_in_optional,
    );

    // Derive the minimal set of hoistable dependencies for each scope and write
    // them onto the matching scope terminal.
    let mut minimal_by_scope: HashMap<ScopeId, Vec<ReactiveScopeDependency>> = HashMap::new();
    for (scope_id, deps) in &scope_deps.deps {
        if deps.is_empty() {
            continue;
        }
        let hoistables = hoistable_by_scope
            .get(scope_id)
            .expect("[PropagateScopeDependencies] Scope not found in tracked blocks");

        let mut tree = ReactiveScopeDependencyTreeHir::new(hoistables.iter().cloned());
        for dep in deps {
            tree.add_dependency(dep.clone());
        }
        let candidates = tree.derive_minimal_dependencies();

        let mut existing: Vec<ReactiveScopeDependency> = Vec::new();
        for candidate in candidates {
            let dup = existing.iter().any(|e| {
                e.identifier.declaration_id == candidate.identifier.declaration_id
                    && are_equal_paths(&e.path, &candidate.path)
            });
            if !dup {
                existing.push(candidate);
            }
        }
        minimal_by_scope.insert(*scope_id, existing);
    }

    // Write the computed dependencies / declarations / reassignments onto each
    // `scope`/`pruned-scope` terminal. The `collectDependencies` traversal mutated
    // the scope `declarations` / `reassignments` of *clones*, so apply them here.
    for block in func.body.blocks_mut() {
        if let Some(scope) = block.terminal.scope_mut() {
            if let Some(updated) = scope_deps.scopes.get(&scope.id) {
                scope.declarations = updated.declarations.clone();
                scope.reassignments = updated.reassignments.clone();
            }
            if let Some(deps) = minimal_by_scope.get(&scope.id) {
                scope.dependencies = deps.clone();
            }
        }
    }
}

/// `areEqualPaths`: the two dependency paths have the same length and equal
/// `(property, optional)` at each position.
fn are_equal_paths(a: &[DependencyPathEntry], b: &[DependencyPathEntry]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(x, y)| property_eq(&x.property, &y.property) && x.optional == y.optional)
}

/// `PropertyLiteral` equality (string or number index).
fn property_eq(a: &PropertyLiteral, b: &PropertyLiteral) -> bool {
    match (a, b) {
        (PropertyLiteral::String(x), PropertyLiteral::String(y)) => x == y,
        (PropertyLiteral::Number(x), PropertyLiteral::Number(y)) => x == y,
        _ => false,
    }
}

fn is_object_method_type(id: &Identifier) -> bool {
    matches!(id.type_, Type::ObjectMethod)
}

fn shape_is(id: &Identifier, shape: &str) -> bool {
    matches!(&id.type_, Type::Object { shape_id: Some(s) } if s == shape)
}

fn is_ref_value_type(id: &Identifier) -> bool {
    shape_is(id, "BuiltInRefValue")
}

fn is_use_ref_type(id: &Identifier) -> bool {
    shape_is(id, "BuiltInUseRefId")
}

// ===========================================================================
// findTemporariesUsedOutsideDeclaringScope
// ===========================================================================

fn find_temporaries_used_outside_declaring_scope(
    func: &HirFunction,
) -> HashSet<DeclarationId> {
    let mut declarations: HashMap<DeclarationId, ScopeId> = HashMap::new();
    let mut pruned_scopes: HashSet<ScopeId> = HashSet::new();
    let mut used_outside: HashSet<DeclarationId> = HashSet::new();
    let mut traversal = ScopeBlockTraversal::new();

    for block in func.body.blocks() {
        traversal.record_scopes(block);
        if let Some(BlockScopeInfo::Begin { scope, pruned, .. }) =
            traversal.block_infos.get(&block.id)
        {
            if *pruned {
                pruned_scopes.insert(scope.id);
            }
        }

        let current = traversal.current_scope();
        let active = current.is_some_and(|s| !pruned_scopes.contains(&s));

        for instr in &block.instructions {
            for place in each_instruction_value_operand(&instr.value) {
                handle_place(place, &declarations, &traversal, &pruned_scopes, &mut used_outside);
            }
            if active {
                if let Some(scope) = current {
                    match &instr.value {
                        InstructionValue::LoadLocal { .. }
                        | InstructionValue::LoadContext { .. }
                        | InstructionValue::PropertyLoad { .. } => {
                            declarations.insert(instr.lvalue.identifier.declaration_id, scope);
                        }
                        _ => {}
                    }
                }
            }
        }
        for place in each_terminal_operand(&block.terminal) {
            handle_place(place, &declarations, &traversal, &pruned_scopes, &mut used_outside);
        }
    }
    used_outside
}

fn handle_place(
    place: &Place,
    declarations: &HashMap<DeclarationId, ScopeId>,
    traversal: &ScopeBlockTraversal,
    pruned_scopes: &HashSet<ScopeId>,
    used_outside: &mut HashSet<DeclarationId>,
) {
    if let Some(&declaring_scope) = declarations.get(&place.identifier.declaration_id) {
        if !traversal.is_scope_active(declaring_scope) && !pruned_scopes.contains(&declaring_scope)
        {
            used_outside.insert(place.identifier.declaration_id);
        }
    }
}

// ===========================================================================
// collectTemporariesSidemap
// ===========================================================================

/// `isLoadContextMutable`: a `LoadContext` whose place's scope ends at or before
/// `instr` (so reordering the read is safe).
fn is_load_context_mutable(value: &InstructionValue, instr: InstructionId) -> bool {
    if let InstructionValue::LoadContext { place, .. } = value {
        if let Some(scope_range_end) = scope_range_end_of(place) {
            return instr.as_u32() >= scope_range_end;
        }
    }
    false
}

/// The `identifier.scope.range.end` of a place's identifier, if it carries a
/// scope. (We do not store the full `ReactiveScope` on identifiers, but the
/// scope's range is mirrored on `mutable_range` once a scope is assigned, and
/// `range_scope`/`scope` track membership; `scope.range.end` corresponds to the
/// identifier's `mutable_range.end`.)
fn scope_range_end_of(place: &Place) -> Option<u32> {
    place
        .identifier
        .scope
        .map(|_| place.identifier.mutable_range.end.as_u32())
}

fn collect_temporaries_sidemap_impl(
    func: &HirFunction,
    used_outside: &HashSet<DeclarationId>,
    temporaries: &mut HashMap<IdentifierId, ReactiveScopeDependency>,
    inner_fn_context: Option<InstructionId>,
) {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            let orig_instr_id = instr.id;
            let instr_id = inner_fn_context.unwrap_or(orig_instr_id);
            let used = used_outside.contains(&instr.lvalue.identifier.declaration_id);

            match &instr.value {
                InstructionValue::PropertyLoad {
                    object,
                    property,
                    loc,
                } if !used => {
                    if inner_fn_context.is_none()
                        || temporaries.contains_key(&object.identifier.id)
                    {
                        let property = get_property(
                            object,
                            property.clone(),
                            false,
                            loc.clone(),
                            temporaries,
                        );
                        temporaries.insert(instr.lvalue.identifier.id, property);
                    }
                }
                value
                    if (matches!(value, InstructionValue::LoadLocal { .. })
                        || is_load_context_mutable(value, instr_id))
                        && instr.lvalue.identifier.name.is_none()
                        && load_place_named(value)
                        && !used =>
                {
                    let place = load_place(value).expect("LoadLocal/LoadContext place");
                    if inner_fn_context.is_none()
                        || func
                            .context
                            .iter()
                            .any(|c| c.identifier.id == place.identifier.id)
                    {
                        temporaries.insert(
                            instr.lvalue.identifier.id,
                            ReactiveScopeDependency {
                                identifier: place.identifier.clone(),
                                reactive: place.reactive,
                                path: Vec::new(),
                                loc: place.loc.clone(),
                            },
                        );
                    }
                }
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    collect_temporaries_sidemap_impl(
                        &lowered_func.func,
                        used_outside,
                        temporaries,
                        inner_fn_context.or(Some(instr_id)),
                    );
                }
                _ => {}
            }
        }
    }
}

/// The loaded place of a `LoadLocal`/`LoadContext`, if any.
fn load_place(value: &InstructionValue) -> Option<&Place> {
    match value {
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            Some(place)
        }
        _ => None,
    }
}

/// Whether a `LoadLocal`/`LoadContext`'s loaded place has a (non-temporary) name
/// (`value.place.identifier.name !== null`).
fn load_place_named(value: &InstructionValue) -> bool {
    load_place(value).is_some_and(|p| p.identifier.name.is_some())
}

/// `getProperty`: resolve `object` through the temporaries sidemap and append
/// `(propertyName, optional)`, producing the extended dependency.
fn get_property(
    object: &Place,
    property_name: PropertyLiteral,
    optional: bool,
    loc: SourceLocation,
    temporaries: &HashMap<IdentifierId, ReactiveScopeDependency>,
) -> ReactiveScopeDependency {
    let resolved = temporaries.get(&object.identifier.id);
    match resolved {
        None => ReactiveScopeDependency {
            identifier: object.identifier.clone(),
            reactive: object.reactive,
            path: vec![DependencyPathEntry {
                property: property_name,
                optional,
                loc: loc.clone(),
            }],
            loc,
        },
        Some(resolved) => {
            let mut path = resolved.path.clone();
            path.push(DependencyPathEntry {
                property: property_name,
                optional,
                loc: loc.clone(),
            });
            ReactiveScopeDependency {
                identifier: resolved.identifier.clone(),
                reactive: resolved.reactive,
                path,
                loc,
            }
        }
    }
}

// ===========================================================================
// ScopeBlockTraversal
// ===========================================================================

#[derive(Clone)]
enum BlockScopeInfo {
    Begin {
        scope: ReactiveScope,
        pruned: bool,
        #[allow(dead_code)]
        fallthrough: BlockId,
    },
    End {
        scope: ReactiveScope,
        pruned: bool,
    },
}

/// Port of `visitors.ts::ScopeBlockTraversal`. Tracks the active reactive-scope
/// stack as blocks are visited in order, driven by `scope`/`pruned-scope`
/// terminals.
struct ScopeBlockTraversal {
    active_scopes: Vec<ScopeId>,
    block_infos: HashMap<BlockId, BlockScopeInfo>,
}

impl ScopeBlockTraversal {
    fn new() -> Self {
        ScopeBlockTraversal {
            active_scopes: Vec::new(),
            block_infos: HashMap::new(),
        }
    }

    fn record_scopes(&mut self, block: &crate::hir::model::BasicBlock) {
        match self.block_infos.get(&block.id) {
            Some(BlockScopeInfo::Begin { scope, .. }) => self.active_scopes.push(scope.id),
            Some(BlockScopeInfo::End { .. }) => {
                self.active_scopes.pop();
            }
            None => {}
        }

        match &block.terminal {
            Terminal::Scope {
                block: body,
                fallthrough,
                scope,
                ..
            } => {
                let pruned = false;
                self.block_infos.insert(
                    *body,
                    BlockScopeInfo::Begin {
                        scope: scope.clone(),
                        pruned,
                        fallthrough: *fallthrough,
                    },
                );
                self.block_infos.insert(
                    *fallthrough,
                    BlockScopeInfo::End {
                        scope: scope.clone(),
                        pruned,
                    },
                );
            }
            Terminal::PrunedScope {
                block: body,
                fallthrough,
                scope,
                ..
            } => {
                let pruned = true;
                self.block_infos.insert(
                    *body,
                    BlockScopeInfo::Begin {
                        scope: scope.clone(),
                        pruned,
                        fallthrough: *fallthrough,
                    },
                );
                self.block_infos.insert(
                    *fallthrough,
                    BlockScopeInfo::End {
                        scope: scope.clone(),
                        pruned,
                    },
                );
            }
            _ => {}
        }
    }

    fn is_scope_active(&self, scope: ScopeId) -> bool {
        self.active_scopes.contains(&scope)
    }

    fn current_scope(&self) -> Option<ScopeId> {
        self.active_scopes.last().copied()
    }
}

// ===========================================================================
// collectDependencies (DependencyCollectionContext)
// ===========================================================================

#[derive(Clone)]
struct Decl {
    id: InstructionId,
    /// The scope stack captured at declaration time (innermost last).
    scope: Vec<ReactiveScope>,
}

/// Result of `collectDependencies`: the per-scope dependency lists plus the
/// scope objects whose `declarations`/`reassignments` were populated.
struct ScopeDepsResult {
    deps: HashMap<ScopeId, Vec<ReactiveScopeDependency>>,
    scopes: HashMap<ScopeId, ReactiveScope>,
}

struct DependencyCollectionContext<'a> {
    declarations: HashMap<DeclarationId, Decl>,
    reassignments: HashMap<IdentifierId, Decl>,
    scopes: Vec<ReactiveScope>,
    dependencies: Vec<Vec<ReactiveScopeDependency>>,
    /// Per-scope-id saved dependency list (unpruned scopes only).
    deps: HashMap<ScopeId, Vec<ReactiveScopeDependency>>,
    /// The scope objects (carrying `declarations`/`reassignments`) keyed by id.
    scope_objects: HashMap<ScopeId, ReactiveScope>,
    temporaries: &'a HashMap<IdentifierId, ReactiveScopeDependency>,
    processed_in_optional: &'a ProcessedSet,
    inner_fn_context: Option<InstructionId>,
}

impl<'a> DependencyCollectionContext<'a> {
    fn new(
        temporaries: &'a HashMap<IdentifierId, ReactiveScopeDependency>,
        processed_in_optional: &'a ProcessedSet,
    ) -> Self {
        DependencyCollectionContext {
            declarations: HashMap::new(),
            reassignments: HashMap::new(),
            scopes: Vec::new(),
            dependencies: Vec::new(),
            deps: HashMap::new(),
            scope_objects: HashMap::new(),
            temporaries,
            processed_in_optional,
            inner_fn_context: None,
        }
    }

    /// Register (or refresh) the canonical scope object for an id, so its
    /// `declarations`/`reassignments` accumulate across the traversal.
    fn ensure_scope_object(&mut self, scope: &ReactiveScope) {
        self.scope_objects
            .entry(scope.id)
            .or_insert_with(|| scope.clone());
    }

    fn enter_scope(&mut self, scope: &ReactiveScope) {
        self.ensure_scope_object(scope);
        self.dependencies.push(Vec::new());
        self.scopes.push(scope.clone());
    }

    fn exit_scope(&mut self, scope: &ReactiveScope, pruned: bool) {
        let scoped_dependencies = self.dependencies.pop().unwrap_or_default();
        self.scopes.pop();

        for dep in &scoped_dependencies {
            if self.check_valid_dependency(dep) {
                if let Some(top) = self.dependencies.last_mut() {
                    top.push(dep.clone());
                }
            }
        }

        if !pruned {
            self.deps.insert(scope.id, scoped_dependencies);
        }
    }

    fn declare(&mut self, identifier: &Identifier, decl: Decl) {
        if self.inner_fn_context.is_some() {
            return;
        }
        self.declarations
            .entry(identifier.declaration_id)
            .or_insert_with(|| decl.clone());
        self.reassignments.insert(identifier.id, decl);
    }

    fn has_declared(&self, identifier: &Identifier) -> bool {
        self.declarations.contains_key(&identifier.declaration_id)
    }

    fn check_valid_dependency(&self, maybe: &ReactiveScopeDependency) -> bool {
        if is_ref_value_type(&maybe.identifier) {
            return false;
        }
        if is_object_method_type(&maybe.identifier) {
            return false;
        }
        let identifier = &maybe.identifier;
        let current_declaration = self
            .reassignments
            .get(&identifier.id)
            .or_else(|| self.declarations.get(&identifier.declaration_id));
        let current_scope = self.scopes.last();
        match (current_scope, current_declaration) {
            (Some(scope), Some(decl)) => decl.id.as_u32() < scope.range.start.as_u32(),
            _ => false,
        }
    }

    fn is_scope_active(&self, scope: &ReactiveScope) -> bool {
        self.scopes.iter().any(|s| s.id == scope.id)
    }

    fn visit_operand(&mut self, place: &Place) {
        let dep = self
            .temporaries
            .get(&place.identifier.id)
            .cloned()
            .unwrap_or_else(|| ReactiveScopeDependency {
                identifier: place.identifier.clone(),
                reactive: place.reactive,
                path: Vec::new(),
                loc: place.loc.clone(),
            });
        self.visit_dependency(dep);
    }

    fn visit_property(
        &mut self,
        object: &Place,
        property: PropertyLiteral,
        optional: bool,
        loc: SourceLocation,
    ) {
        let next = get_property(object, property, optional, loc, self.temporaries);
        self.visit_dependency(next);
    }

    fn visit_dependency(&mut self, mut maybe: ReactiveScopeDependency) {
        // Promote child-scope-declared values to scope `declarations`.
        if let Some(original) = self.declarations.get(&maybe.identifier.declaration_id).cloned() {
            if !original.scope.is_empty() {
                // The scope-stack at declaration time, innermost last; TS `.each`
                // iterates outer→inner, but only membership + presence is checked.
                let decl_id = maybe.identifier.declaration_id;
                let decl_ident_id = maybe.identifier.id;
                let decl_identifier = maybe.identifier.clone();
                let innermost = original.scope.last().cloned();
                for scope in &original.scope {
                    if self.is_scope_active(scope) {
                        continue;
                    }
                    let already = self
                        .scope_objects
                        .get(&scope.id)
                        .map(|s| {
                            s.declarations
                                .iter()
                                .any(|(_, d)| d.identifier.declaration_id == decl_id)
                        })
                        .unwrap_or(false);
                    if !already {
                        if let Some(target) = self.scope_objects.get_mut(&scope.id) {
                            // `scope: originalDeclaration.scope.value!` — the
                            // innermost declaring scope id.
                            let decl_scope = innermost.as_ref().map(|s| s.id).unwrap_or(scope.id);
                            target.declarations.push((
                                decl_ident_id,
                                ScopeDeclaration {
                                    identifier: decl_identifier.clone(),
                                    scope: decl_scope,
                                },
                            ));
                        }
                    }
                }
            }
        }

        // `ref.current` access is not a valid dep.
        if is_use_ref_type(&maybe.identifier)
            && maybe
                .path
                .first()
                .is_some_and(|e| matches!(&e.property, PropertyLiteral::String(s) if s == "current"))
        {
            maybe = ReactiveScopeDependency {
                identifier: maybe.identifier,
                reactive: maybe.reactive,
                path: Vec::new(),
                loc: maybe.loc,
            };
        }

        if self.check_valid_dependency(&maybe) {
            if let Some(top) = self.dependencies.last_mut() {
                top.push(maybe);
            }
        }
    }

    fn visit_reassignment(&mut self, place: &Place) {
        let dep = ReactiveScopeDependency {
            identifier: place.identifier.clone(),
            reactive: place.reactive,
            path: Vec::new(),
            loc: place.loc.clone(),
        };
        let valid = self.check_valid_dependency(&dep);
        if let Some(current) = self.scopes.last().map(|s| s.id) {
            if valid {
                let scope_obj = self.scope_objects.entry(current).or_insert_with(|| {
                    self.scopes
                        .iter()
                        .find(|s| s.id == current)
                        .cloned()
                        .unwrap()
                });
                let already = scope_obj
                    .reassignments
                    .iter()
                    .any(|i| i.declaration_id == place.identifier.declaration_id);
                if !already {
                    scope_obj.reassignments.push(place.identifier.clone());
                }
            }
        }
    }

    fn current_scope_stack(&self) -> Vec<ReactiveScope> {
        self.scopes.clone()
    }

    fn is_deferred_instruction(&self, key: ProcessedKey) -> bool {
        self.processed_in_optional.contains(&key)
    }

    /// `isDeferredDependency` for an instruction: processed-in-optional OR its
    /// lvalue is already tracked in the temporaries sidemap.
    fn is_deferred_for_instr(&self, key: ProcessedKey, lvalue_id: IdentifierId) -> bool {
        self.is_deferred_instruction(key) || self.temporaries.contains_key(&lvalue_id)
    }
}

fn collect_dependencies(
    func: &HirFunction,
    _used_outside: &HashSet<DeclarationId>,
    temporaries: &HashMap<IdentifierId, ReactiveScopeDependency>,
    processed_in_optional: &ProcessedSet,
) -> ScopeDepsResult {
    let mut context = DependencyCollectionContext::new(temporaries, processed_in_optional);

    for param in &func.params {
        let ident = match param {
            crate::hir::model::FunctionParam::Place(place) => &place.identifier,
            crate::hir::model::FunctionParam::Spread(spread) => &spread.place.identifier,
        };
        context.declare(
            ident,
            Decl {
                id: InstructionId::new(0),
                scope: Vec::new(),
            },
        );
    }

    handle_function(func, &mut context);

    ScopeDepsResult {
        deps: context.deps,
        scopes: context.scope_objects,
    }
}

fn handle_function(func: &HirFunction, context: &mut DependencyCollectionContext) {
    let mut traversal = ScopeBlockTraversal::new();
    for block in func.body.blocks() {
        traversal.record_scopes(block);
        match traversal.block_infos.get(&block.id) {
            Some(BlockScopeInfo::Begin { scope, .. }) => {
                let scope = scope.clone();
                context.enter_scope(&scope);
            }
            Some(BlockScopeInfo::End { scope, pruned }) => {
                let scope = scope.clone();
                let pruned = *pruned;
                context.exit_scope(&scope, pruned);
            }
            None => {}
        }

        // Record referenced optional chains in phis.
        for phi in &block.phis {
            for (_, operand) in phi.operands.iter() {
                if let Some(chain) = context.temporaries.get(&operand.identifier.id).cloned() {
                    context.visit_dependency(chain);
                }
            }
        }

        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    context.declare(
                        &instr.lvalue.identifier,
                        Decl {
                            id: instr.id,
                            scope: context.current_scope_stack(),
                        },
                    );
                    let prev = context.inner_fn_context;
                    if context.inner_fn_context.is_none() {
                        context.inner_fn_context = Some(instr.id);
                    }
                    handle_function(&lowered_func.func, context);
                    context.inner_fn_context = prev;
                }
                _ => handle_instruction(instr, context),
            }
        }

        // The processed-in-optional set keys a `Branch` terminal by its test-operand
        // `IdentifierId` (globally unique; terminal ids collide across nested
        // functions — see `ProcessedKey`). Only a `Branch` is ever recorded there.
        let deferred_terminal = match &block.terminal {
            Terminal::Branch { test, .. } => {
                context.is_deferred_instruction(ProcessedKey::Terminal(test.identifier.id))
            }
            _ => false,
        };
        if !deferred_terminal {
            for place in each_terminal_operand(&block.terminal) {
                context.visit_operand(place);
            }
        }
    }
}

fn handle_instruction(
    instr: &crate::hir::instruction::Instruction,
    context: &mut DependencyCollectionContext,
) {
    let id = instr.id;
    let scope = context.current_scope_stack();
    context.declare(
        &instr.lvalue.identifier,
        Decl {
            id,
            scope: scope.clone(),
        },
    );

    // The processed-in-optional set keys an instruction by its lvalue
    // `IdentifierId` (globally unique; instruction ids collide across nested
    // functions — see `ProcessedKey`).
    let instr_key = ProcessedKey::Instruction(instr.lvalue.identifier.id);
    if context.is_deferred_for_instr(instr_key, instr.lvalue.identifier.id) {
        return;
    }

    match &instr.value {
        InstructionValue::PropertyLoad {
            object,
            property,
            loc,
        } => {
            context.visit_property(object, property.clone(), false, loc.clone());
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            context.visit_operand(value);
            if lvalue.kind == InstructionKind::Reassign {
                context.visit_reassignment(&lvalue.place);
            }
            context.declare(
                &lvalue.place.identifier,
                Decl {
                    id,
                    scope: context.current_scope_stack(),
                },
            );
        }
        InstructionValue::DeclareLocal { lvalue, .. } => {
            if convert_hoisted_lvalue_kind(lvalue.kind).is_none() {
                context.declare(
                    &lvalue.place.identifier,
                    Decl {
                        id,
                        scope: context.current_scope_stack(),
                    },
                );
            }
        }
        InstructionValue::DeclareContext { kind, place, .. } => {
            if convert_hoisted_lvalue_kind(*kind).is_none() {
                context.declare(
                    &place.identifier,
                    Decl {
                        id,
                        scope: context.current_scope_stack(),
                    },
                );
            }
        }
        InstructionValue::Destructure { lvalue, value, .. } => {
            context.visit_operand(value);
            for place in each_pattern_operand(&lvalue.pattern) {
                if lvalue.kind == InstructionKind::Reassign {
                    context.visit_reassignment(place);
                }
                context.declare(
                    &place.identifier,
                    Decl {
                        id,
                        scope: context.current_scope_stack(),
                    },
                );
            }
        }
        InstructionValue::StoreContext { kind, place, .. } => {
            if !context.has_declared(&place.identifier) || *kind != InstructionKind::Reassign {
                context.declare(
                    &place.identifier,
                    Decl {
                        id,
                        scope: context.current_scope_stack(),
                    },
                );
            }
            for operand in each_instruction_value_operand(&instr.value) {
                context.visit_operand(operand);
            }
        }
        _ => {
            for operand in each_instruction_value_operand(&instr.value) {
                context.visit_operand(operand);
            }
        }
    }
}

/// `convertHoistedLValueKind`: maps `Hoisted*` kinds to their realized kind, and
/// returns `None` for already-real kinds.
fn convert_hoisted_lvalue_kind(kind: InstructionKind) -> Option<InstructionKind> {
    match kind {
        InstructionKind::HoistedLet => Some(InstructionKind::Let),
        InstructionKind::HoistedConst => Some(InstructionKind::Const),
        InstructionKind::HoistedFunction => Some(InstructionKind::Function),
        InstructionKind::Let
        | InstructionKind::Const
        | InstructionKind::Function
        | InstructionKind::Reassign
        | InstructionKind::Catch => None,
    }
}

/// `eachPatternOperand`: the bound places of a destructuring pattern.
fn each_pattern_operand(pattern: &Pattern) -> Vec<&Place> {
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

// ===========================================================================
// Processed-instruction set (optional-chain deferral)
// ===========================================================================

/// A key into the processed-in-optional set. The TS `#processedInstrsInOptional`
/// is a `Set<Instruction | Terminal>` keyed by *object identity*, which is unique
/// across nested functions. We cannot key by [`InstructionId`]/terminal id because
/// those are allocated per-function (numbered from 1 in each nested function body),
/// so a nested-function instruction at id N would alias an outer-function
/// instruction at id N and wrongly defer it (e.g. `reordering-across-blocks`, where
/// a `config?.onA?.()` `StoreLocal` inside the `a` lambda has the same instruction
/// id as the outer `const a = …` `StoreLocal`, suppressing the outer scope
/// declaration). Both variants therefore key on a globally-unique [`IdentifierId`]:
/// the matched `StoreLocal`'s lvalue id, and the test `Branch`'s test-operand id.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum ProcessedKey {
    Instruction(IdentifierId),
    Terminal(IdentifierId),
}

type ProcessedSet = HashSet<ProcessedKey>;

// ===========================================================================
// collectOptionalChainSidemap
// ===========================================================================

struct OptionalChainSidemap {
    temporaries_read_in_optional: HashMap<IdentifierId, ReactiveScopeDependency>,
    processed_instrs_in_optional: ProcessedSet,
    hoistable_objects: HashMap<BlockId, ReactiveScopeDependency>,
}

include!("propagate_scope_dependencies_hir/optional_chain.rs");
include!("propagate_scope_dependencies_hir/hoistable_loads.rs");
include!("propagate_scope_dependencies_hir/minimal_deps.rs");
include!("propagate_scope_dependencies_hir/resolve_loc.rs");
