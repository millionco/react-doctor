//! `PruneNonEscapingScopes`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PruneNonEscapingScopes.ts`.
//!
//! Prunes reactive scopes that are not necessary to bound downstream computation.
//! A value "escapes" if it is returned (or transitively aliased by a return) or
//! passed as a hook argument. Scopes whose declarations/reassignments do not
//! escape are inlined (their body replaces the scope block); the rest are kept.
//!
//! The pass has three phases:
//! 1. `CollectDependenciesVisitor` builds, per `DeclarationId`, an
//!    [`IdentifierNode`] describing its memoization `level`, its dependency set,
//!    and the scopes it participates in; plus the set of escaping declarations
//!    (returns + non-noAlias hook args). `LoadLocal` indirections are tracked in
//!    `definitions` so loads resolve to their source declaration.
//! 2. `computeMemoizedIdentifiers` walks the graph from the escaping roots,
//!    promoting nodes to `memoized` per the level rules and force-memoizing the
//!    dependencies of every scope a memoized node belongs to.
//! 3. `PruneScopesTransform` inlines every scope with no memoized output.
//!
//! Because this pass models data flow (not control flow) it keys on
//! `DeclarationId`, matching the TS.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{DeclarationId, InstructionId, ScopeId};
use crate::hir::place::{Effect, Identifier, Place};
use crate::hir::terminal::ReactiveScope;
use crate::hir::value::{
    ArrayPatternItem, InstructionValue, ObjectPatternProperty, Pattern,
};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};
use super::prune_non_reactive_dependencies::each_reactive_value_operand;

/// `pruneNonEscapingScopes(fn)`.
///
/// `force_memoize_primitives` is the resolved value of the `forceMemoizePrimitives`
/// option (`PruneNonEscapingScopes.ts:410-412`):
/// `enableForest || enablePreserveExistingMemoizationGuarantees`. Since `enableForest`
/// is always `false` in this environment, callers pass
/// `env.config.enable_preserve_existing_memoization_guarantees`.
pub fn prune_non_escaping_scopes(func: &mut ReactiveFunction, force_memoize_primitives: bool) {
    // Build a `ScopeId -> ReactiveScope` lookup so `getPlaceScope` can resolve a
    // place's declared scope (the place only carries the scope id). Scope ranges
    // and dependencies are read from these snapshots.
    let mut scope_table: HashMap<ScopeId, ReactiveScope> = HashMap::new();
    collect_scope_table(&func.body, &mut scope_table);

    let mut state = State::new(&scope_table);
    // Declare the params.
    for param in &func.params {
        let id = match param {
            crate::hir::model::FunctionParam::Place(place) => place.identifier.declaration_id,
            crate::hir::model::FunctionParam::Spread(spread) => {
                spread.place.identifier.declaration_id
            }
        };
        state.declare(id);
    }

    let mut visitor = CollectDependenciesVisitor::new(&mut state, force_memoize_primitives);
    visitor.visit_block(&func.body, &[]);

    let memoized = compute_memoized_identifiers(&mut state);

    let mut transform = PruneScopesTransform::new(&memoized);
    transform.transform_block(&mut func.body);
}

// ---- memoization level ----

/// `MemoizationLevel` — how to decide whether a value should be memoized relative
/// to its dependees/dependencies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MemoizationLevel {
    Memoized,
    Conditional,
    Unmemoized,
    Never,
}

/// `joinAliases(a, b)`: the maximal level of two lvalue memoization levels.
fn join_aliases(a: MemoizationLevel, b: MemoizationLevel) -> MemoizationLevel {
    use MemoizationLevel::*;
    if a == Memoized || b == Memoized {
        Memoized
    } else if a == Conditional || b == Conditional {
        Conditional
    } else if a == Unmemoized || b == Unmemoized {
        Unmemoized
    } else {
        Never
    }
}

// ---- graph nodes ----

/// A node in the memoization graph for one `DeclarationId`.
#[derive(Clone, Debug)]
struct IdentifierNode {
    level: MemoizationLevel,
    memoized: bool,
    dependencies: Vec<DeclarationId>,
    dependencies_seen: HashSet<DeclarationId>,
    scopes: Vec<ScopeId>,
    scopes_seen: HashSet<ScopeId>,
    seen: bool,
}

impl IdentifierNode {
    fn new() -> Self {
        IdentifierNode {
            level: MemoizationLevel::Never,
            memoized: false,
            dependencies: Vec::new(),
            dependencies_seen: HashSet::new(),
            scopes: Vec::new(),
            scopes_seen: HashSet::new(),
            seen: false,
        }
    }

    fn add_dependency(&mut self, id: DeclarationId) {
        if self.dependencies_seen.insert(id) {
            self.dependencies.push(id);
        }
    }

    fn add_scope(&mut self, id: ScopeId) {
        if self.scopes_seen.insert(id) {
            self.scopes.push(id);
        }
    }
}

/// A scope node describing its (declaration-id) dependencies.
#[derive(Clone, Debug)]
struct ScopeNode {
    dependencies: Vec<DeclarationId>,
    seen: bool,
}

/// The pass state: identifier/scope graphs, escaping-value roots, LoadLocal
/// indirections, and the scope-id table.
struct State<'a> {
    definitions: HashMap<DeclarationId, DeclarationId>,
    identifiers: HashMap<DeclarationId, IdentifierNode>,
    scopes: HashMap<ScopeId, ScopeNode>,
    escaping_values: Vec<DeclarationId>,
    escaping_seen: HashSet<DeclarationId>,
    scope_table: &'a HashMap<ScopeId, ReactiveScope>,
}

impl<'a> State<'a> {
    fn new(scope_table: &'a HashMap<ScopeId, ReactiveScope>) -> Self {
        State {
            definitions: HashMap::new(),
            identifiers: HashMap::new(),
            scopes: HashMap::new(),
            escaping_values: Vec::new(),
            escaping_seen: HashSet::new(),
            scope_table,
        }
    }

    fn declare(&mut self, id: DeclarationId) {
        self.identifiers.insert(id, IdentifierNode::new());
    }

    fn add_escaping(&mut self, id: DeclarationId) {
        if self.escaping_seen.insert(id) {
            self.escaping_values.push(id);
        }
    }

    /// `getPlaceScope(id, place)`: the place's declared scope if active at `id`.
    fn get_place_scope(&self, id: InstructionId, place: &Place) -> Option<&ReactiveScope> {
        let scope_id = place.identifier.scope?;
        let scope = self.scope_table.get(&scope_id)?;
        if id.as_u32() >= scope.range.start.as_u32() && id.as_u32() < scope.range.end.as_u32() {
            Some(scope)
        } else {
            None
        }
    }

    /// `visitOperand(id, place, identifier)`: record the place's active scope and
    /// associate the identifier node with it.
    fn visit_operand(&mut self, id: InstructionId, place: &Place, identifier: DeclarationId) {
        let Some(scope) = self.get_place_scope(id, place) else {
            return;
        };
        let scope_id = scope.id;
        if !self.scopes.contains_key(&scope_id) {
            let dependencies = scope
                .dependencies
                .iter()
                .map(|dep| dep.identifier.declaration_id)
                .collect();
            self.scopes.insert(
                scope_id,
                ScopeNode {
                    dependencies,
                    seen: false,
                },
            );
        }
        let node = self
            .identifiers
            .get_mut(&identifier)
            .expect("Expected identifier to be initialized");
        node.add_scope(scope_id);
    }
}

/// Build the `ScopeId -> ReactiveScope` lookup from every scope / pruned-scope
/// block in the tree.
fn collect_scope_table(block: &ReactiveBlock, table: &mut HashMap<ScopeId, ReactiveScope>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                table.insert(scope.scope.id, scope.scope.clone());
                collect_scope_table(&scope.instructions, table);
            }
            ReactiveStatement::Terminal(term_stmt) => {
                collect_scope_table_terminal(&term_stmt.terminal, table);
            }
            // Scope blocks never appear inside instruction values.
            ReactiveStatement::Instruction(_) => {}
        }
    }
}

fn collect_scope_table_terminal(
    terminal: &ReactiveTerminal,
    table: &mut HashMap<ScopeId, ReactiveScope>,
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
        | ReactiveTerminal::While { loop_, .. } => collect_scope_table(loop_, table),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            collect_scope_table(consequent, table);
            if let Some(alternate) = alternate {
                collect_scope_table(alternate, table);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &case.block {
                    collect_scope_table(block, table);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => collect_scope_table(block, table),
        ReactiveTerminal::Try { block, handler, .. } => {
            collect_scope_table(block, table);
            collect_scope_table(handler, table);
        }
    }
}

// ---- pattern lvalues ----

struct LValueMemoization<'a> {
    place: &'a Place,
    level: MemoizationLevel,
}

/// `computePatternLValues(pattern)`.
fn compute_pattern_lvalues(pattern: &Pattern) -> Vec<LValueMemoization<'_>> {
    let mut lvalues = Vec::new();
    match pattern {
        Pattern::Array(array) => {
            for item in &array.items {
                match item {
                    ArrayPatternItem::Place(place) => lvalues.push(LValueMemoization {
                        place,
                        level: MemoizationLevel::Conditional,
                    }),
                    ArrayPatternItem::Spread(spread) => lvalues.push(LValueMemoization {
                        place: &spread.place,
                        level: MemoizationLevel::Memoized,
                    }),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &object.properties {
                match property {
                    ObjectPatternProperty::Property(p) => lvalues.push(LValueMemoization {
                        place: &p.place,
                        level: MemoizationLevel::Conditional,
                    }),
                    ObjectPatternProperty::Spread(spread) => lvalues.push(LValueMemoization {
                        place: &spread.place,
                        level: MemoizationLevel::Memoized,
                    }),
                }
            }
        }
    }
    lvalues
}

// ---- isMutableEffect / noAlias ----

/// `isMutableEffect(effect, loc)`: Capture/Store/ConditionallyMutate/Mutate are
/// mutable; Read/Freeze are not. (Unknown is an invariant violation upstream.)
fn is_mutable_effect(effect: Effect) -> bool {
    matches!(
        effect,
        Effect::Capture
            | Effect::Store
            | Effect::ConditionallyMutate
            | Effect::ConditionallyMutateIterator
            | Effect::Mutate
    )
}

/// `getFunctionCallSignature(env, type)?.noAlias === true`.
///
/// `noAlias` is carried by the builtin array/object higher-order methods in
/// `HIR/ObjectShape.ts` (`map`/`filter`/`every`/`some`/`find`/`findIndex`/
/// `forEach`) and by the `useFragment`/`useNoAlias` shared-runtime hooks
/// (`makeSharedRuntimeTypeProvider`). When set, a hook/method call's arguments do
/// not escape via the callee, so the call's rvalues are dropped from the
/// memoization inputs (`call_like_arm`). The flag is read off the callee
/// identifier's resolved function-shape [`CallSignature`].
fn signature_no_alias(identifier: &Identifier) -> bool {
    crate::environment::shapes::get_function_signature(&identifier.type_)
        .map(|sig| sig.no_alias)
        .unwrap_or(false)
}

// ---- CollectDependenciesVisitor ----

struct CollectDependenciesVisitor<'s, 'a> {
    state: &'s mut State<'a>,
    memoize_jsx_elements: bool,
    force_memoize_primitives: bool,
}

/// The lvalue/rvalue decomposition `computeMemoizationInputs` returns. Cloned
/// places are owned so they can be returned past the borrow of `value`.
struct MemoizationInputs {
    lvalues: Vec<(Place, MemoizationLevel)>,
    rvalues: Vec<Place>,
}

impl<'s, 'a> CollectDependenciesVisitor<'s, 'a> {
    fn new(state: &'s mut State<'a>, force_memoize_primitives: bool) -> Self {
        // `enableForest` is always `false` in this environment, so
        // (PruneNonEscapingScopes.ts:408-413):
        //   memoizeJsxElements     = !enableForest                              = true
        //   forceMemoizePrimitives = enableForest || enablePreserveExisting...
        //                          = enablePreserveExistingMemoizationGuarantees
        // The latter is passed in by the caller from the resolved config; fixtures
        // that set `@enablePreserveExistingMemoizationGuarantees:false` therefore
        // do *not* force primitive-producing instructions to be memoized, which is
        // what allows an allocating-call→primitive-load chain (e.g.
        // `foo(bar(props).b + 1)`) to drop the `bar(...)` scope.
        CollectDependenciesVisitor {
            state,
            memoize_jsx_elements: true,
            force_memoize_primitives,
        }
    }

    /// `computeMemoizationInputs(value, lvalue)`.
    fn compute_memoization_inputs(
        &mut self,
        value: &ReactiveValue,
        lvalue: Option<&Place>,
    ) -> MemoizationInputs {
        match value {
            ReactiveValue::Ternary(ternary) => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: {
                    let mut rv = self.compute_memoization_inputs(&ternary.consequent, None).rvalues;
                    rv.extend(self.compute_memoization_inputs(&ternary.alternate, None).rvalues);
                    rv
                },
            },
            ReactiveValue::Logical(logical) => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: {
                    let mut rv = self.compute_memoization_inputs(&logical.left, None).rvalues;
                    rv.extend(self.compute_memoization_inputs(&logical.right, None).rvalues);
                    rv
                },
            },
            ReactiveValue::Sequence(sequence) => {
                for instr in &sequence.instructions {
                    self.visit_value_for_memoization(
                        instr.id,
                        &instr.value,
                        instr.lvalue.as_ref(),
                    );
                }
                MemoizationInputs {
                    lvalues: cond_lvalue(lvalue),
                    rvalues: self.compute_memoization_inputs(&sequence.value, None).rvalues,
                }
            }
            ReactiveValue::OptionalCall(optional) => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: self.compute_memoization_inputs(&optional.value, None).rvalues,
            },
            ReactiveValue::Instruction(instr) => {
                self.compute_instruction_inputs(instr.as_ref(), value, lvalue)
            }
        }
    }

    fn compute_instruction_inputs(
        &mut self,
        instr: &InstructionValue,
        value: &ReactiveValue,
        lvalue: Option<&Place>,
    ) -> MemoizationInputs {
        use MemoizationLevel::*;
        match instr {
            InstructionValue::JsxExpression {
                tag,
                props,
                children,
                ..
            } => {
                let mut operands: Vec<Place> = Vec::new();
                if let crate::hir::value::JsxTag::Place(place) = tag {
                    operands.push(place.clone());
                }
                for prop in props {
                    match prop {
                        crate::hir::value::JsxAttribute::Attribute { place, .. } => {
                            operands.push(place.clone())
                        }
                        crate::hir::value::JsxAttribute::Spread { argument } => {
                            operands.push(argument.clone())
                        }
                    }
                }
                if let Some(children) = children {
                    for child in children {
                        operands.push(child.clone());
                    }
                }
                let level = if self.memoize_jsx_elements {
                    Memoized
                } else {
                    Unmemoized
                };
                MemoizationInputs {
                    lvalues: lvalue.map(|l| vec![(l.clone(), level)]).unwrap_or_default(),
                    rvalues: operands,
                }
            }
            InstructionValue::JsxFragment { children, .. } => {
                let level = if self.memoize_jsx_elements {
                    Memoized
                } else {
                    Unmemoized
                };
                MemoizationInputs {
                    lvalues: lvalue.map(|l| vec![(l.clone(), level)]).unwrap_or_default(),
                    rvalues: children.clone(),
                }
            }
            InstructionValue::NextPropertyOf { .. }
            | InstructionValue::StartMemoize { .. }
            | InstructionValue::FinishMemoize { .. }
            | InstructionValue::Debugger { .. }
            | InstructionValue::ComputedDelete { .. }
            | InstructionValue::PropertyDelete { .. }
            | InstructionValue::LoadGlobal { .. }
            | InstructionValue::MetaProperty { .. }
            | InstructionValue::TemplateLiteral { .. }
            | InstructionValue::Primitive { .. }
            | InstructionValue::JsxText { .. }
            | InstructionValue::BinaryExpression { .. }
            | InstructionValue::UnaryExpression { .. } => {
                if self.force_memoize_primitives {
                    MemoizationInputs {
                        lvalues: lvalue.map(|l| vec![(l.clone(), Conditional)]).unwrap_or_default(),
                        rvalues: each_reactive_value_operand(value)
                            .into_iter()
                            .cloned()
                            .collect(),
                    }
                } else {
                    MemoizationInputs {
                        lvalues: lvalue.map(|l| vec![(l.clone(), Never)]).unwrap_or_default(),
                        rvalues: Vec::new(),
                    }
                }
            }
            InstructionValue::Await { value: inner, .. }
            | InstructionValue::TypeCastExpression { value: inner, .. } => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: vec![inner.clone()],
            },
            InstructionValue::IteratorNext {
                iterator,
                collection,
                ..
            } => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: vec![iterator.clone(), collection.clone()],
            },
            InstructionValue::GetIterator { collection, .. } => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: vec![collection.clone()],
            },
            InstructionValue::LoadLocal { place, .. }
            | InstructionValue::LoadContext { place, .. } => MemoizationInputs {
                lvalues: cond_lvalue(lvalue),
                rvalues: vec![place.clone()],
            },
            InstructionValue::DeclareContext { place, .. } => {
                let mut lvalues = vec![(place.clone(), Memoized)];
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Unmemoized));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: Vec::new(),
                }
            }
            InstructionValue::DeclareLocal { lvalue: lv, .. } => {
                let mut lvalues = vec![(lv.place.clone(), Unmemoized)];
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Unmemoized));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: Vec::new(),
                }
            }
            InstructionValue::PrefixUpdate { lvalue: lv, value: rv, .. }
            | InstructionValue::PostfixUpdate { lvalue: lv, value: rv, .. } => {
                let mut lvalues = vec![(lv.clone(), Conditional)];
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Conditional));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: vec![rv.clone()],
                }
            }
            InstructionValue::StoreLocal { lvalue: lv, value: rv, .. } => {
                let mut lvalues = vec![(lv.place.clone(), Conditional)];
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Conditional));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: vec![rv.clone()],
                }
            }
            InstructionValue::StoreContext { place, value: rv, .. } => {
                let mut lvalues = vec![(place.clone(), Memoized)];
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Conditional));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: vec![rv.clone()],
                }
            }
            InstructionValue::StoreGlobal { value: rv, .. } => {
                let mut lvalues = Vec::new();
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Unmemoized));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: vec![rv.clone()],
                }
            }
            InstructionValue::Destructure { lvalue: lv, value: rv, .. } => {
                let mut lvalues = Vec::new();
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Conditional));
                }
                for plm in compute_pattern_lvalues(&lv.pattern) {
                    lvalues.push((plm.place.clone(), plm.level));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: vec![rv.clone()],
                }
            }
            InstructionValue::ComputedLoad { object, .. }
            | InstructionValue::PropertyLoad { object, .. } => MemoizationInputs {
                lvalues: lvalue.map(|l| vec![(l.clone(), Conditional)]).unwrap_or_default(),
                rvalues: vec![object.clone()],
            },
            InstructionValue::ComputedStore { object, value: rv, .. } => {
                let mut lvalues = vec![(object.clone(), Conditional)];
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Conditional));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: vec![rv.clone()],
                }
            }
            InstructionValue::TaggedTemplateExpression { tag, .. } => {
                self.call_like_arm(value, lvalue, signature_no_alias(&tag.identifier))
            }
            InstructionValue::CallExpression { callee, .. } => {
                self.call_like_arm(value, lvalue, signature_no_alias(&callee.identifier))
            }
            InstructionValue::MethodCall { property, .. } => {
                self.call_like_arm(value, lvalue, signature_no_alias(&property.identifier))
            }
            InstructionValue::RegExpLiteral { .. }
            | InstructionValue::ObjectMethod { .. }
            | InstructionValue::FunctionExpression { .. }
            | InstructionValue::ArrayExpression { .. }
            | InstructionValue::NewExpression { .. }
            | InstructionValue::ObjectExpression { .. }
            | InstructionValue::PropertyStore { .. } => {
                self.mutable_operands_arm_all(value, lvalue)
            }
            InstructionValue::UnsupportedNode { .. } => {
                let mut lvalues = Vec::new();
                if let Some(l) = lvalue {
                    lvalues.push((l.clone(), Never));
                }
                MemoizationInputs {
                    lvalues,
                    rvalues: Vec::new(),
                }
            }
        }
    }

    /// The `CallExpression`/`MethodCall`/`TaggedTemplateExpression` arm.
    fn call_like_arm(
        &mut self,
        value: &ReactiveValue,
        lvalue: Option<&Place>,
        no_alias: bool,
    ) -> MemoizationInputs {
        use MemoizationLevel::*;
        let mut lvalues = Vec::new();
        if let Some(l) = lvalue {
            lvalues.push((l.clone(), Memoized));
        }
        if no_alias {
            return MemoizationInputs {
                lvalues,
                rvalues: Vec::new(),
            };
        }
        let operands: Vec<Place> = each_reactive_value_operand(value)
            .into_iter()
            .cloned()
            .collect();
        for op in &operands {
            if is_mutable_effect(op.effect) {
                lvalues.push((op.clone(), Memoized));
            }
        }
        MemoizationInputs {
            lvalues,
            rvalues: operands,
        }
    }

    /// The "always produces a new value" arm (Array/Object/New/Function/…): every
    /// operand is an rvalue, mutable operands also act as Memoized lvalues.
    fn mutable_operands_arm_all(
        &mut self,
        value: &ReactiveValue,
        lvalue: Option<&Place>,
    ) -> MemoizationInputs {
        use MemoizationLevel::*;
        let operands: Vec<Place> = each_reactive_value_operand(value)
            .into_iter()
            .cloned()
            .collect();
        let mut lvalues: Vec<(Place, MemoizationLevel)> = operands
            .iter()
            .filter(|op| is_mutable_effect(op.effect))
            .map(|op| (op.clone(), Memoized))
            .collect();
        if let Some(l) = lvalue {
            lvalues.push((l.clone(), Memoized));
        }
        MemoizationInputs {
            lvalues,
            rvalues: operands,
        }
    }

    /// `visitValueForMemoization(id, value, lvalue)`.
    fn visit_value_for_memoization(
        &mut self,
        id: InstructionId,
        value: &ReactiveValue,
        lvalue: Option<&Place>,
    ) {
        let aliasing = self.compute_memoization_inputs(value, lvalue);

        // Associate all rvalues with the instruction's scope.
        for operand in &aliasing.rvalues {
            let operand_id = self.resolve(operand.identifier.declaration_id);
            self.state.visit_operand(id, operand, operand_id);
        }

        // Add operands as dependencies of all lvalues.
        for (lv_place, level) in &aliasing.lvalues {
            let lvalue_id = self.resolve(lv_place.identifier.declaration_id);
            let node = self
                .state
                .identifiers
                .entry(lvalue_id)
                .or_insert_with(IdentifierNode::new);
            node.level = join_aliases(node.level, *level);
            for operand in &aliasing.rvalues {
                let operand_id = self
                    .state
                    .definitions
                    .get(&operand.identifier.declaration_id)
                    .copied()
                    .unwrap_or(operand.identifier.declaration_id);
                if operand_id == lvalue_id {
                    continue;
                }
                node.add_dependency(operand_id);
            }
            self.state.visit_operand(id, lv_place, lvalue_id);
        }

        // LoadLocal indirection / hook-argument escape.
        match value {
            ReactiveValue::Instruction(instr) => match instr.as_ref() {
                InstructionValue::LoadLocal { place, .. } => {
                    if lvalue.is_some() {
                        let l = lvalue.unwrap();
                        self.state.definitions.insert(
                            l.identifier.declaration_id,
                            place.identifier.declaration_id,
                        );
                    }
                }
                InstructionValue::CallExpression { callee, args, .. } => {
                    self.maybe_escape_hook_args(callee, args);
                }
                InstructionValue::MethodCall { property, args, .. } => {
                    self.maybe_escape_hook_args(property, args);
                }
                _ => {}
            },
            _ => {}
        }
    }

    fn resolve(&self, id: DeclarationId) -> DeclarationId {
        self.state.definitions.get(&id).copied().unwrap_or(id)
    }

    /// If `callee` is a hook (and not noAlias), all args escape.
    fn maybe_escape_hook_args(
        &mut self,
        callee: &Place,
        args: &[crate::hir::value::CallArgument],
    ) {
        use crate::passes::infer_reactive_places::get_hook_kind;
        if get_hook_kind(&callee.identifier).is_none() {
            return;
        }
        if signature_no_alias(&callee.identifier) {
            return;
        }
        for arg in args {
            let place = match arg {
                crate::hir::value::CallArgument::Place(p) => p,
                crate::hir::value::CallArgument::Spread(s) => &s.place,
            };
            self.state.add_escaping(place.identifier.declaration_id);
        }
    }

    // ---- tree traversal (ReactiveFunctionVisitor over the body) ----

    fn visit_block(&mut self, block: &ReactiveBlock, scopes: &[ReactiveScope]) {
        for stmt in block {
            match stmt {
                ReactiveStatement::Instruction(instruction) => {
                    self.visit_value_for_memoization(
                        instruction.id,
                        &instruction.value,
                        instruction.lvalue.as_ref(),
                    );
                }
                ReactiveStatement::Scope(scope_block) => self.visit_scope(scope_block, scopes),
                ReactiveStatement::PrunedScope(scope_block) => {
                    // `traversePrunedScope`: visit the inner block (pruned scopes
                    // don't push themselves as an active scope).
                    self.visit_block(&scope_block.instructions, scopes);
                }
                ReactiveStatement::Terminal(term_stmt) => {
                    self.visit_terminal(term_stmt, scopes);
                }
            }
        }
    }

    fn visit_scope(&mut self, scope_block: &ReactiveScopeBlock, scopes: &[ReactiveScope]) {
        // Reassignments: set the chain of active scopes (+ this scope) as deps of
        // the reassigned variable's node.
        for reassignment in &scope_block.scope.reassignments {
            let node = self
                .state
                .identifiers
                .get_mut(&reassignment.declaration_id)
                .expect("Expected identifier to be initialized");
            for scope in scopes {
                node.add_scope(scope.id);
            }
            node.add_scope(scope_block.scope.id);
        }
        let mut inner: Vec<ReactiveScope> = scopes.to_vec();
        inner.push(scope_block.scope.clone());
        self.visit_block(&scope_block.instructions, &inner);
    }

    fn visit_terminal(
        &mut self,
        term_stmt: &super::model::ReactiveTerminalStatement,
        scopes: &[ReactiveScope],
    ) {
        // traverseTerminal: recurse into nested blocks/values, then handle return.
        match &term_stmt.terminal {
            ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
            ReactiveTerminal::Return { value, .. } => {
                self.state.add_escaping(value.identifier.declaration_id);
                let node = self
                    .state
                    .identifiers
                    .get_mut(&value.identifier.declaration_id)
                    .expect("Expected identifier to be initialized");
                for scope in scopes {
                    node.add_scope(scope.id);
                }
            }
            ReactiveTerminal::Throw { .. } => {}
            ReactiveTerminal::For {
                init,
                test,
                update,
                loop_,
                ..
            } => {
                self.visit_terminal_value(init, term_stmt);
                self.visit_terminal_value(test, term_stmt);
                self.visit_block(loop_, scopes);
                if let Some(update) = update {
                    self.visit_terminal_value(update, term_stmt);
                }
            }
            ReactiveTerminal::ForOf {
                init, test, loop_, ..
            } => {
                self.visit_terminal_value(init, term_stmt);
                self.visit_terminal_value(test, term_stmt);
                self.visit_block(loop_, scopes);
            }
            ReactiveTerminal::ForIn { init, loop_, .. } => {
                self.visit_terminal_value(init, term_stmt);
                self.visit_block(loop_, scopes);
            }
            ReactiveTerminal::DoWhile { loop_, test, .. } => {
                self.visit_block(loop_, scopes);
                self.visit_terminal_value(test, term_stmt);
            }
            ReactiveTerminal::While { test, loop_, .. } => {
                self.visit_terminal_value(test, term_stmt);
                self.visit_block(loop_, scopes);
            }
            ReactiveTerminal::If {
                consequent,
                alternate,
                ..
            } => {
                self.visit_block(consequent, scopes);
                if let Some(alternate) = alternate {
                    self.visit_block(alternate, scopes);
                }
            }
            ReactiveTerminal::Switch { cases, .. } => {
                for case in cases {
                    if let Some(block) = &case.block {
                        self.visit_block(block, scopes);
                    }
                }
            }
            ReactiveTerminal::Label { block, .. } => self.visit_block(block, scopes),
            ReactiveTerminal::Try { block, handler, .. } => {
                self.visit_block(block, scopes);
                self.visit_block(handler, scopes);
            }
        }
    }

    /// A terminal's init/test/update is a `ReactiveValue`; the visitor calls
    /// `visitValue` which only recurses Sequence members via visitInstruction.
    /// `visitValue` on a non-sequence does not call `visitValueForMemoization`
    /// (the `CollectDependenciesVisitor` only overrides `visitInstruction`), so
    /// only the Sequence members are processed.
    fn visit_terminal_value(
        &mut self,
        value: &ReactiveValue,
        _term_stmt: &super::model::ReactiveTerminalStatement,
    ) {
        if let ReactiveValue::Sequence(seq) = value {
            for instr in &seq.instructions {
                self.visit_value_for_memoization(instr.id, &instr.value, instr.lvalue.as_ref());
            }
            // The final value: visitValue recurses; for a sequence the final
            // value is itself visited via visitValue, descending into any nested
            // sequence's members.
            self.visit_terminal_value(&seq.value, _term_stmt);
        } else if let ReactiveValue::Logical(l) = value {
            self.visit_terminal_value(&l.left, _term_stmt);
            self.visit_terminal_value(&l.right, _term_stmt);
        } else if let ReactiveValue::Ternary(t) = value {
            self.visit_terminal_value(&t.test, _term_stmt);
            self.visit_terminal_value(&t.consequent, _term_stmt);
            self.visit_terminal_value(&t.alternate, _term_stmt);
        } else if let ReactiveValue::OptionalCall(o) = value {
            self.visit_terminal_value(&o.value, _term_stmt);
        }
    }
}

fn cond_lvalue(lvalue: Option<&Place>) -> Vec<(Place, MemoizationLevel)> {
    lvalue
        .map(|l| vec![(l.clone(), MemoizationLevel::Conditional)])
        .unwrap_or_default()
}

// ---- computeMemoizedIdentifiers ----

fn compute_memoized_identifiers(state: &mut State<'_>) -> HashSet<DeclarationId> {
    let mut memoized: HashSet<DeclarationId> = HashSet::new();
    let roots = state.escaping_values.clone();
    for value in roots {
        visit(state, &mut memoized, value, false);
    }
    memoized
}

/// `visit(id, forceMemoize)` from `computeMemoizedIdentifiers`.
fn visit(
    state: &mut State<'_>,
    memoized: &mut HashSet<DeclarationId>,
    id: DeclarationId,
    force_memoize: bool,
) -> bool {
    {
        let node = state
            .identifiers
            .get_mut(&id)
            .expect("Expected a node for all identifiers");
        if node.seen {
            return node.memoized;
        }
        node.seen = true;
        node.memoized = false;
    }

    // Visit dependencies.
    let deps = state.identifiers.get(&id).unwrap().dependencies.clone();
    let mut has_memoized_dependency = false;
    for dep in deps {
        let is_dep_memoized = visit(state, memoized, dep, false);
        has_memoized_dependency |= is_dep_memoized;
    }

    let (level, scopes) = {
        let node = state.identifiers.get(&id).unwrap();
        (node.level, node.scopes.clone())
    };

    let should_memoize = level == MemoizationLevel::Memoized
        || (level == MemoizationLevel::Conditional && (has_memoized_dependency || force_memoize))
        || (level == MemoizationLevel::Unmemoized && force_memoize);

    if should_memoize {
        state.identifiers.get_mut(&id).unwrap().memoized = true;
        memoized.insert(id);
        for scope in scopes {
            force_memoize_scope_dependencies(state, memoized, scope);
        }
    }
    state.identifiers.get(&id).unwrap().memoized
}

fn force_memoize_scope_dependencies(
    state: &mut State<'_>,
    memoized: &mut HashSet<DeclarationId>,
    scope_id: ScopeId,
) {
    let deps = {
        let node = state
            .scopes
            .get_mut(&scope_id)
            .expect("Expected a node for all scopes");
        if node.seen {
            return;
        }
        node.seen = true;
        node.dependencies.clone()
    };
    for dep in deps {
        visit(state, memoized, dep, true);
    }
}

// ---- PruneScopesTransform ----

struct PruneScopesTransform<'m> {
    memoized: &'m HashSet<DeclarationId>,
    /// Scope ids that were pruned (inlined) during this transform. Used to mark
    /// `FinishMemoize.pruned` (`PruneNonEscapingScopes.ts`'s `prunedScopes`).
    pruned_scopes: HashSet<ScopeId>,
    /// Reassignment chains for inlined useMemo temporaries, keyed by the
    /// reassigned/lvalue declarationId (`PruneNonEscapingScopes.ts`'s
    /// `reassignments`).
    reassignments: HashMap<DeclarationId, Vec<crate::hir::place::Identifier>>,
}

impl<'m> PruneScopesTransform<'m> {
    fn new(memoized: &'m HashSet<DeclarationId>) -> Self {
        PruneScopesTransform {
            memoized,
            pruned_scopes: HashSet::new(),
            reassignments: HashMap::new(),
        }
    }

    fn transform_block(&mut self, block: &mut ReactiveBlock) {
        let mut next: Vec<ReactiveStatement> = Vec::with_capacity(block.len());
        for stmt in block.drain(..) {
            match stmt {
                ReactiveStatement::Scope(mut scope_block) => {
                    self.transform_block(&mut scope_block.instructions);
                    if self.should_keep(&scope_block) {
                        next.push(ReactiveStatement::Scope(scope_block));
                    } else {
                        // replace-many with the scope's instructions (inline). The
                        // scope id joins `prunedScopes` so a later `FinishMemoize`
                        // decl in this pruned scope is marked pruned.
                        self.pruned_scopes.insert(scope_block.scope.id);
                        next.extend(scope_block.instructions);
                    }
                }
                ReactiveStatement::PrunedScope(mut scope_block) => {
                    self.transform_block(&mut scope_block.instructions);
                    next.push(ReactiveStatement::PrunedScope(scope_block));
                }
                ReactiveStatement::Terminal(mut term_stmt) => {
                    self.transform_terminal_blocks(&mut term_stmt.terminal);
                    next.push(ReactiveStatement::Terminal(term_stmt));
                }
                ReactiveStatement::Instruction(mut instruction) => {
                    self.transform_instruction(&mut instruction);
                    next.push(ReactiveStatement::Instruction(instruction));
                }
            }
        }
        *block = next;
    }

    /// `transformInstruction` (`PruneNonEscapingScopes.ts:1067-1119`): track
    /// reassignment chains for inlined useMemo temporaries, and mark a
    /// `FinishMemoize` pruned when all its memo decls are unscoped or in pruned
    /// scopes (so `validatePreservedManualMemoization` does not false-positive on a
    /// non-escaping value that was correctly pruned).
    fn transform_instruction(&mut self, instruction: &mut ReactiveInstruction) {
        let lvalue_decl = instruction.lvalue.as_ref().map(|l| l.identifier.clone());
        let lvalue_scope_none = instruction
            .lvalue
            .as_ref()
            .is_some_and(|l| l.identifier.scope.is_none());
        if let ReactiveValue::Instruction(boxed) = &instruction.value {
            match boxed.as_ref() {
                InstructionValue::StoreLocal { lvalue, value, .. }
                    if lvalue.kind == crate::hir::value::InstructionKind::Reassign =>
                {
                    // Complex cases of useMemo inlining: a reassigned temporary.
                    self.reassignments
                        .entry(lvalue.place.identifier.declaration_id)
                        .or_default()
                        .push(value.identifier.clone());
                }
                InstructionValue::LoadLocal { place, .. }
                    if place.identifier.scope.is_some() && lvalue_scope_none =>
                {
                    // Simpler cases: a direct LoadLocal of a scoped place into the
                    // original (unscoped) lvalue.
                    if let Some(decl) = &lvalue_decl {
                        self.reassignments
                            .entry(decl.declaration_id)
                            .or_default()
                            .push(place.identifier.clone());
                    }
                }
                _ => {}
            }
        }
        if let ReactiveValue::Instruction(boxed) = &mut instruction.value {
            if let InstructionValue::FinishMemoize { decl, pruned, .. } = boxed.as_mut() {
                let decls: Vec<crate::hir::place::Identifier> = if decl.identifier.scope.is_none() {
                    self.reassignments
                        .get(&decl.identifier.declaration_id)
                        .cloned()
                        .unwrap_or_else(|| vec![decl.identifier.clone()])
                } else {
                    vec![decl.identifier.clone()]
                };
                if decls
                    .iter()
                    .all(|d| d.scope.is_none() || self.pruned_scopes.contains(&d.scope.unwrap()))
                {
                    *pruned = true;
                }
            }
        }
    }

    fn transform_terminal_blocks(&mut self, terminal: &mut ReactiveTerminal) {
        match terminal {
            ReactiveTerminal::Break { .. }
            | ReactiveTerminal::Continue { .. }
            | ReactiveTerminal::Return { .. }
            | ReactiveTerminal::Throw { .. } => {}
            ReactiveTerminal::For { loop_, .. }
            | ReactiveTerminal::ForOf { loop_, .. }
            | ReactiveTerminal::ForIn { loop_, .. }
            | ReactiveTerminal::DoWhile { loop_, .. }
            | ReactiveTerminal::While { loop_, .. } => self.transform_block(loop_),
            ReactiveTerminal::If {
                consequent,
                alternate,
                ..
            } => {
                self.transform_block(consequent);
                if let Some(alternate) = alternate {
                    self.transform_block(alternate);
                }
            }
            ReactiveTerminal::Switch { cases, .. } => {
                for case in cases {
                    if let Some(block) = &mut case.block {
                        self.transform_block(block);
                    }
                }
            }
            ReactiveTerminal::Label { block, .. } => self.transform_block(block),
            ReactiveTerminal::Try { block, handler, .. } => {
                self.transform_block(block);
                self.transform_block(handler);
            }
        }
    }

    /// Whether the scope has a memoized output (and thus is kept). Empty scopes
    /// (no declarations + no reassignments) and scopes with an `earlyReturnValue`
    /// are also kept (the latter never occurs at this stage).
    fn should_keep(&self, scope_block: &ReactiveScopeBlock) -> bool {
        let scope = &scope_block.scope;
        if scope.declarations.is_empty() && scope.reassignments.is_empty() {
            return true;
        }
        // `earlyReturnValue` is not modeled (always null at this stage).
        scope
            .declarations
            .iter()
            .any(|(_, decl)| self.memoized.contains(&decl.identifier.declaration_id))
            || scope
                .reassignments
                .iter()
                .any(|ident| self.memoized.contains(&ident.declaration_id))
    }
}
