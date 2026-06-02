// Included from `propagate_scope_dependencies_hir.rs`.
//
// Port of `HIR/CollectHoistablePropertyLoads.ts`. CFG fixed-point analysis that
// determines which property paths are safe to hoist (non-null) at each block,
// returning a per-scope set of hoistable `PropertyPathNode`s. Only the parts
// reachable from `propagateScopeDependenciesHIR` are ported.

use crate::hir::value::{CallArgument, JsxAttribute, JsxTag, MemoDependencyRoot};

// ---------------------------------------------------------------------------
// PropertyPathRegistry
// ---------------------------------------------------------------------------

/// A node in the property-path registry. Nodes are interned in a flat arena and
/// referenced by index, so identical paths dedupe to the same index (matching
/// the TS object identity used by `Set<PropertyPathNode>`).
#[derive(Clone)]
struct PropertyPathNode {
    full_path: ReactiveScopeDependency,
    has_optional: bool,
    /// `properties` (non-optional) child entries: property -> node index.
    properties: HashMap<PropKey, usize>,
    /// `optionalProperties` child entries.
    optional_properties: HashMap<PropKey, usize>,
}

/// A hashable property-literal key.
#[derive(Clone, PartialEq, Eq, Hash)]
enum PropKey {
    String(String),
    /// Numbers are keyed by their bit pattern (JS `Map` keys numbers by value;
    /// property indices are always integral here).
    Number(u64),
}

fn prop_key(p: &PropertyLiteral) -> PropKey {
    match p {
        PropertyLiteral::String(s) => PropKey::String(s.clone()),
        PropertyLiteral::Number(n) => PropKey::Number(n.to_bits()),
    }
}

struct PropertyPathRegistry {
    nodes: Vec<PropertyPathNode>,
    roots: HashMap<IdentifierId, usize>,
}

impl PropertyPathRegistry {
    fn new() -> Self {
        PropertyPathRegistry {
            nodes: Vec::new(),
            roots: HashMap::new(),
        }
    }

    fn get_or_create_identifier(
        &mut self,
        identifier: &Identifier,
        reactive: bool,
        loc: SourceLocation,
    ) -> usize {
        if let Some(&idx) = self.roots.get(&identifier.id) {
            return idx;
        }
        let node = PropertyPathNode {
            full_path: ReactiveScopeDependency {
                identifier: identifier.clone(),
                reactive,
                path: Vec::new(),
                loc,
            },
            has_optional: false,
            properties: HashMap::new(),
            optional_properties: HashMap::new(),
        };
        let idx = self.nodes.len();
        self.nodes.push(node);
        self.roots.insert(identifier.id, idx);
        idx
    }

    fn get_or_create_property_entry(
        &mut self,
        parent: usize,
        entry: &DependencyPathEntry,
    ) -> usize {
        let key = prop_key(&entry.property);
        let existing = if entry.optional {
            self.nodes[parent].optional_properties.get(&key).copied()
        } else {
            self.nodes[parent].properties.get(&key).copied()
        };
        if let Some(idx) = existing {
            return idx;
        }
        let parent_full = self.nodes[parent].full_path.clone();
        let parent_has_optional = self.nodes[parent].has_optional;
        let mut path = parent_full.path.clone();
        path.push(entry.clone());
        let node = PropertyPathNode {
            full_path: ReactiveScopeDependency {
                identifier: parent_full.identifier.clone(),
                reactive: parent_full.reactive,
                path,
                loc: entry.loc.clone(),
            },
            has_optional: parent_has_optional || entry.optional,
            properties: HashMap::new(),
            optional_properties: HashMap::new(),
        };
        let idx = self.nodes.len();
        self.nodes.push(node);
        if entry.optional {
            self.nodes[parent].optional_properties.insert(key, idx);
        } else {
            self.nodes[parent].properties.insert(key, idx);
        }
        idx
    }

    fn get_or_create_property(&mut self, dep: &ReactiveScopeDependency) -> usize {
        let mut curr = self.get_or_create_identifier(&dep.identifier, dep.reactive, dep.loc.clone());
        if dep.path.is_empty() {
            return curr;
        }
        for entry in &dep.path[..dep.path.len() - 1] {
            curr = self.get_or_create_property_entry(curr, entry);
        }
        self.get_or_create_property_entry(curr, dep.path.last().unwrap())
    }
}

// ---------------------------------------------------------------------------
// BlockInfo
// ---------------------------------------------------------------------------

struct BlockInfo {
    /// Indices into the registry's node arena.
    assumed_non_null_objects: Vec<usize>,
}

struct CollectContext<'a> {
    temporaries: &'a HashMap<IdentifierId, ReactiveScopeDependency>,
    known_immutable: HashSet<IdentifierId>,
    hoistable_from_optionals: &'a HashMap<BlockId, ReactiveScopeDependency>,
    registry: PropertyPathRegistry,
    nested_fn_immutable_context: Option<HashSet<IdentifierId>>,
    assumed_invoked_fns: HashSet<IdentifierId>,
}

/// `collectHoistablePropertyLoads` — returns the per-block hoistable node sets.
fn collect_hoistable_property_loads(
    func: &HirFunction,
    temporaries: &HashMap<IdentifierId, ReactiveScopeDependency>,
    hoistable_from_optionals: &HashMap<BlockId, ReactiveScopeDependency>,
) -> HashMap<BlockId, Vec<ReactiveScopeDependency>> {
    let mut known_immutable: HashSet<IdentifierId> = HashSet::new();
    if matches!(
        func.fn_type,
        crate::hir::model::ReactFunctionType::Component | crate::hir::model::ReactFunctionType::Hook
    ) {
        for p in &func.params {
            if let crate::hir::model::FunctionParam::Place(place) = p {
                known_immutable.insert(place.identifier.id);
            }
        }
    }
    let assumed = get_assumed_invoked_functions(func);
    let mut context = CollectContext {
        temporaries,
        known_immutable,
        hoistable_from_optionals,
        registry: PropertyPathRegistry::new(),
        nested_fn_immutable_context: None,
        assumed_invoked_fns: assumed,
    };
    let nodes = collect_hoistable_property_loads_impl(func, &mut context);
    // Materialize node indices into owned `ReactiveScopeDependency`s.
    let mut out = HashMap::new();
    for (block_id, info) in nodes {
        let deps = info
            .assumed_non_null_objects
            .iter()
            .map(|&idx| context.registry.nodes[idx].full_path.clone())
            .collect();
        out.insert(block_id, deps);
    }
    out
}

fn collect_hoistable_property_loads_impl(
    func: &HirFunction,
    context: &mut CollectContext,
) -> HashMap<BlockId, BlockInfo> {
    let mut nodes = collect_non_nulls_in_blocks(func, context);
    propagate_non_null(func, &mut nodes, &mut context.registry);
    nodes
}

/// `keyByScopeId`: scope id -> hoistable nodes of the scope-body block.
fn key_by_scope_id(
    func: &HirFunction,
    source: &HashMap<BlockId, Vec<ReactiveScopeDependency>>,
) -> HashMap<ScopeId, Vec<ReactiveScopeDependency>> {
    let mut out = HashMap::new();
    for block in func.body.blocks() {
        if let Terminal::Scope {
            block: body, scope, ..
        } = &block.terminal
        {
            if let Some(nodes) = source.get(body) {
                out.insert(scope.id, nodes.clone());
            }
        }
    }
    out
}

/// `isImmutableAtInstr`.
fn is_immutable_at_instr(
    identifier: &Identifier,
    instr: InstructionId,
    context: &CollectContext,
) -> bool {
    if let Some(ctx) = &context.nested_fn_immutable_context {
        return ctx.contains(&identifier.id);
    }
    let mutable_at_instr = identifier.mutable_range.end.as_u32()
        > identifier.mutable_range.start.as_u32() + 1
        && identifier.scope.is_some()
        && in_range(instr, &identifier.mutable_range);
    !mutable_at_instr || context.known_immutable.contains(&identifier.id)
}

/// `inRange({id}, range)`: `range.start <= id < range.end` (the scope range is
/// mirrored on `mutable_range` once a scope is assigned).
fn in_range(instr: InstructionId, range: &crate::hir::place::MutableRange) -> bool {
    instr.as_u32() >= range.start.as_u32() && instr.as_u32() < range.end.as_u32()
}

/// `getMaybeNonNullInInstruction`: the registry node for the object whose
/// property/destructure/computed read this instruction performs, if any.
fn get_maybe_non_null_in_instruction(
    value: &InstructionValue,
    context: &mut CollectContext,
) -> Option<usize> {
    let path: Option<ReactiveScopeDependency> = match value {
        InstructionValue::PropertyLoad { object, loc, .. } => Some(
            context
                .temporaries
                .get(&object.identifier.id)
                .cloned()
                .unwrap_or_else(|| ReactiveScopeDependency {
                    identifier: object.identifier.clone(),
                    reactive: object.reactive,
                    path: Vec::new(),
                    loc: loc.clone(),
                }),
        ),
        InstructionValue::Destructure { value, .. } => {
            context.temporaries.get(&value.identifier.id).cloned()
        }
        InstructionValue::ComputedLoad { object, .. } => {
            context.temporaries.get(&object.identifier.id).cloned()
        }
        _ => None,
    };
    path.map(|p| context.registry.get_or_create_property(&p))
}

fn collect_non_nulls_in_blocks(
    func: &HirFunction,
    context: &mut CollectContext,
) -> HashMap<BlockId, BlockInfo> {
    // Known non-null roots: a component's first (identifier) param.
    let mut known_non_null_roots: Vec<usize> = Vec::new();
    if matches!(func.fn_type, crate::hir::model::ReactFunctionType::Component)
        && !func.params.is_empty()
    {
        if let crate::hir::model::FunctionParam::Place(place) = &func.params[0] {
            let idx = context
                .registry
                .get_or_create_identifier(&place.identifier, true, place.loc.clone());
            known_non_null_roots.push(idx);
        }
    }

    let mut nodes: HashMap<BlockId, BlockInfo> = HashMap::new();
    for block in func.body.blocks() {
        // `Set<PropertyPathNode>(knownNonNullIdentifiers)` — start from the known
        // roots (insertion order preserved; dedupe by index).
        let mut assumed: Vec<usize> = known_non_null_roots.clone();
        let mut seen: HashSet<usize> = assumed.iter().copied().collect();
        let add = |idx: usize, assumed: &mut Vec<usize>, seen: &mut HashSet<usize>| {
            if seen.insert(idx) {
                assumed.push(idx);
            }
        };

        if let Some(chain) = context.hoistable_from_optionals.get(&block.id).cloned() {
            let idx = context.registry.get_or_create_property(&chain);
            add(idx, &mut assumed, &mut seen);
        }

        for instr in &block.instructions {
            if let Some(idx) = get_maybe_non_null_in_instruction(&instr.value, context) {
                let ident = context.registry.nodes[idx].full_path.identifier.clone();
                if is_immutable_at_instr(&ident, instr.id, context) {
                    add(idx, &mut assumed, &mut seen);
                }
            }
            if let InstructionValue::FunctionExpression { lowered_func, .. } = &instr.value {
                if context.assumed_invoked_fns.contains(&instr.lvalue.identifier.id) {
                    let inner_fn = &lowered_func.func;
                    // Build the nested immutable context if not already set.
                    let saved_ctx = context.nested_fn_immutable_context.clone();
                    if context.nested_fn_immutable_context.is_none() {
                        let mut set = HashSet::new();
                        for place in &inner_fn.context {
                            if is_immutable_at_instr(&place.identifier, instr.id, context) {
                                set.insert(place.identifier.id);
                            }
                        }
                        context.nested_fn_immutable_context = Some(set);
                    }
                    let inner_assumed = get_assumed_invoked_functions(inner_fn);
                    let saved_assumed = std::mem::replace(
                        &mut context.assumed_invoked_fns,
                        inner_assumed,
                    );
                    let inner_nodes = collect_hoistable_property_loads_impl(inner_fn, context);
                    context.assumed_invoked_fns = saved_assumed;
                    context.nested_fn_immutable_context = saved_ctx;

                    if let Some(entry_info) = inner_nodes.get(&inner_fn.body.entry) {
                        for &idx in &entry_info.assumed_non_null_objects {
                            add(idx, &mut assumed, &mut seen);
                        }
                    }
                }
            } else if let InstructionValue::StartMemoize { deps: Some(deps), .. } = &instr.value {
                // `enablePreserveExistingMemoizationGuarantees` defaults off, so the
                // StartMemoize hoistable path is not taken; kept here for fidelity but
                // guarded off.
                let _ = deps;
            }
        }

        nodes.insert(
            block.id,
            BlockInfo {
                assumed_non_null_objects: assumed,
            },
        );
    }
    nodes
}

/// `propagateNonNull`: CFG fixed-point — `X = Union(Intersect(neighbors), X)`,
/// alternating forward (over preds) and backward (over succs) passes.
fn propagate_non_null(
    func: &HirFunction,
    nodes: &mut HashMap<BlockId, BlockInfo>,
    registry: &mut PropertyPathRegistry,
) {
    // Successors map + the block order.
    let mut block_successors: HashMap<BlockId, Vec<BlockId>> = HashMap::new();
    let block_order: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    let preds: HashMap<BlockId, Vec<BlockId>> = func
        .body
        .blocks()
        .iter()
        .map(|b| (b.id, b.preds.iter().copied().collect::<Vec<_>>()))
        .collect();
    for block in func.body.blocks() {
        for pred in block.preds.iter() {
            block_successors.entry(*pred).or_default().push(block.id);
        }
    }

    let reversed: Vec<BlockId> = block_order.iter().rev().copied().collect();

    let mut iter = 0;
    loop {
        iter += 1;
        assert!(
            iter < 100,
            "[CollectHoistablePropertyLoads] fixed point iteration did not terminate after 100 loops"
        );
        let mut changed = false;

        let mut traversal_state: HashMap<BlockId, TraversalStatus> = HashMap::new();
        for &block_id in &block_order {
            let c = recursively_propagate_non_null(
                block_id,
                Direction::Forward,
                &mut traversal_state,
                nodes,
                registry,
                &preds,
                &block_successors,
            );
            changed |= c;
        }
        let mut traversal_state: HashMap<BlockId, TraversalStatus> = HashMap::new();
        for &block_id in &reversed {
            let c = recursively_propagate_non_null(
                block_id,
                Direction::Backward,
                &mut traversal_state,
                nodes,
                registry,
                &preds,
                &block_successors,
            );
            changed |= c;
        }

        if !changed {
            break;
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum TraversalStatus {
    Active,
    Done,
}

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    Forward,
    Backward,
}

#[allow(clippy::too_many_arguments)]
fn recursively_propagate_non_null(
    node_id: BlockId,
    direction: Direction,
    traversal_state: &mut HashMap<BlockId, TraversalStatus>,
    nodes: &mut HashMap<BlockId, BlockInfo>,
    registry: &mut PropertyPathRegistry,
    preds: &HashMap<BlockId, Vec<BlockId>>,
    successors: &HashMap<BlockId, Vec<BlockId>>,
) -> bool {
    if traversal_state.contains_key(&node_id) {
        return false;
    }
    traversal_state.insert(node_id, TraversalStatus::Active);

    let neighbors: Vec<BlockId> = match direction {
        Direction::Backward => successors.get(&node_id).cloned().unwrap_or_default(),
        Direction::Forward => preds.get(&node_id).cloned().unwrap_or_default(),
    };

    let mut changed = false;
    for &pred in &neighbors {
        if !traversal_state.contains_key(&pred) {
            let c = recursively_propagate_non_null(
                pred,
                direction,
                traversal_state,
                nodes,
                registry,
                preds,
                successors,
            );
            changed |= c;
        }
    }

    // Intersect the done-neighbors' assumedNonNullObjects.
    let done_neighbors: Vec<BlockId> = neighbors
        .iter()
        .copied()
        .filter(|n| traversal_state.get(n) == Some(&TraversalStatus::Done))
        .collect();
    let neighbor_accesses = intersect_node_sets(&done_neighbors, nodes);

    let prev_objects = nodes.get(&node_id).unwrap().assumed_non_null_objects.clone();
    let mut merged = union_node_sets(&prev_objects, &neighbor_accesses);
    reduce_maybe_optional_chains(&mut merged, registry);

    let changed_here = !node_sets_equal(&prev_objects, &merged);
    nodes.get_mut(&node_id).unwrap().assumed_non_null_objects = merged;
    traversal_state.insert(node_id, TraversalStatus::Done);
    changed |= changed_here;
    changed
}

/// Intersection of the given blocks' node sets (`Set_intersect`). Empty input =>
/// empty result. Order follows the first set's insertion order.
fn intersect_node_sets(
    block_ids: &[BlockId],
    nodes: &HashMap<BlockId, BlockInfo>,
) -> Vec<usize> {
    if block_ids.is_empty() {
        return Vec::new();
    }
    let first = &nodes.get(&block_ids[0]).unwrap().assumed_non_null_objects;
    let rest_sets: Vec<HashSet<usize>> = block_ids[1..]
        .iter()
        .map(|b| {
            nodes
                .get(b)
                .unwrap()
                .assumed_non_null_objects
                .iter()
                .copied()
                .collect()
        })
        .collect();
    first
        .iter()
        .copied()
        .filter(|idx| rest_sets.iter().all(|s| s.contains(idx)))
        .collect()
}

/// Union preserving `a` first then new-from-`b` (`Set_union`).
fn union_node_sets(a: &[usize], b: &[usize]) -> Vec<usize> {
    let mut out = a.to_vec();
    let mut seen: HashSet<usize> = a.iter().copied().collect();
    for &idx in b {
        if seen.insert(idx) {
            out.push(idx);
        }
    }
    out
}

fn node_sets_equal(a: &[usize], b: &[usize]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let sa: HashSet<usize> = a.iter().copied().collect();
    b.iter().all(|idx| sa.contains(idx))
}

/// `reduceMaybeOptionalChains`: replace `a?.b` with `a.b` where `a` is in the
/// non-null set, iterating to a fixpoint over the optional-chain nodes.
fn reduce_maybe_optional_chains(nodes: &mut Vec<usize>, registry: &mut PropertyPathRegistry) {
    let mut optional_chain: Vec<usize> = nodes
        .iter()
        .copied()
        .filter(|&idx| registry.nodes[idx].has_optional)
        .collect();
    if optional_chain.is_empty() {
        return;
    }
    loop {
        let mut changed = false;
        let current = optional_chain.clone();
        for original in current {
            let full = registry.nodes[original].full_path.clone();
            let mut curr = registry.get_or_create_identifier(
                &full.identifier,
                full.reactive,
                full.loc.clone(),
            );
            for entry in &full.path {
                let in_set = nodes.contains(&curr);
                let next_entry = if entry.optional && in_set {
                    DependencyPathEntry {
                        property: entry.property.clone(),
                        optional: false,
                        loc: entry.loc.clone(),
                    }
                } else {
                    entry.clone()
                };
                curr = registry.get_or_create_property_entry(curr, &next_entry);
            }
            if curr != original {
                changed = true;
                optional_chain.retain(|&x| x != original);
                if !optional_chain.contains(&curr) {
                    optional_chain.push(curr);
                }
                nodes.retain(|&x| x != original);
                if !nodes.contains(&curr) {
                    nodes.push(curr);
                }
            }
        }
        if !changed {
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// getAssumedInvokedFunctions
// ---------------------------------------------------------------------------

/// A function "key" identifying a `LoweredFunction` by the `IdentifierId` of the
/// `FunctionExpression` instruction whose lvalue produced it.
type FnKey = IdentifierId;

/// `getAssumedInvokedFunctions(fn)` — returns the set of `FunctionExpression`
/// lvalue ids whose lowered functions are assumed to be eventually called.
fn get_assumed_invoked_functions(func: &HirFunction) -> HashSet<IdentifierId> {
    let mut temporaries: HashMap<IdentifierId, FnTemp> = HashMap::new();
    let mut hoistable: HashSet<FnKey> = HashSet::new();
    get_assumed_invoked_functions_impl(func, &mut temporaries, &mut hoistable);

    // Final closure: assumed-invoked funcs propagate their mayInvoke.
    for temp in temporaries.values() {
        if hoistable.contains(&temp.key) {
            for &called in &temp.may_invoke {
                hoistable.insert(called);
            }
        }
    }
    hoistable
}

#[derive(Clone)]
struct FnTemp {
    key: FnKey,
    may_invoke: HashSet<FnKey>,
}

fn get_assumed_invoked_functions_impl(
    func: &HirFunction,
    temporaries: &mut HashMap<IdentifierId, FnTemp>,
    hoistable: &mut HashSet<FnKey>,
) {
    // Step 1: identifier -> function-expression key mapping.
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::FunctionExpression { .. } => {
                    temporaries.insert(
                        instr.lvalue.identifier.id,
                        FnTemp {
                            key: instr.lvalue.identifier.id,
                            may_invoke: HashSet::new(),
                        },
                    );
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    if let Some(t) = temporaries.get(&value.identifier.id).cloned() {
                        temporaries.insert(lvalue.place.identifier.id, t);
                    }
                }
                InstructionValue::LoadLocal { place, .. } => {
                    if let Some(t) = temporaries.get(&place.identifier.id).cloned() {
                        temporaries.insert(instr.lvalue.identifier.id, t);
                    }
                }
                _ => {}
            }
        }
    }

    // Step 2: forward analysis of assumed function calls.
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::CallExpression { callee, args, .. } => {
                    let maybe_hook = callee_is_hook(callee);
                    if let Some(t) = temporaries.get(&callee.identifier.id) {
                        hoistable.insert(t.key);
                    } else if maybe_hook {
                        for arg in args {
                            if let CallArgument::Place(place) = arg {
                                if let Some(t) = temporaries.get(&place.identifier.id) {
                                    hoistable.insert(t.key);
                                }
                            }
                        }
                    }
                }
                InstructionValue::JsxExpression {
                    props, children, ..
                } => {
                    for attr in props {
                        if let JsxAttribute::Attribute { place, .. } = attr {
                            if let Some(t) = temporaries.get(&place.identifier.id) {
                                hoistable.insert(t.key);
                            }
                        }
                    }
                    if let Some(children) = children {
                        for child in children {
                            if let Some(t) = temporaries.get(&child.identifier.id) {
                                hoistable.insert(t.key);
                            }
                        }
                    }
                }
                InstructionValue::FunctionExpression { lowered_func, .. } => {
                    let mut inner_hoistable: HashSet<FnKey> = HashSet::new();
                    let lambdas_called = {
                        // Recurse with the shared `temporaries` map (matching the TS,
                        // which threads `temporaries` through the recursive call).
                        get_assumed_invoked_functions_impl(
                            &lowered_func.func,
                            temporaries,
                            &mut inner_hoistable,
                        );
                        // The recursive call's "hoistableFunctions" return value is the
                        // set it accumulated; mirror that.
                        inner_hoistable
                    };
                    if let Some(t) = temporaries.get_mut(&instr.lvalue.identifier.id) {
                        for called in lambdas_called {
                            t.may_invoke.insert(called);
                        }
                    }
                }
                _ => {}
            }
        }
        if let Terminal::Return { value, .. } = &block.terminal {
            if let Some(t) = temporaries.get(&value.identifier.id) {
                hoistable.insert(t.key);
            }
        }
    }
}

/// Whether a callee place references a hook (`getHookKind(env, callee.identifier)
/// != null`, `CollectHoistablePropertyLoads.ts:742`). `getHookKind` consults the
/// callee's *type signature* (`getFunctionSignature(type)?.hookKind`), so a
/// `useEffect`/`useLayoutEffect`/custom-hook callee resolves to a hook even though
/// the lowered callee place is an unnamed temporary (the `LoadGlobal` result, name
/// `null`). We delegate to the shared [`get_hook_kind`] shape-id map rather than
/// re-checking the name, so a typed effect hook (`DefaultNonmutatingHook`) — whose
/// callback's `useEffect(cb, [deps])` argument must be treated as assumed-invoked
/// so the callback's interior `users.length` reads stay hoistable granular
/// dependencies — is correctly recognized.
fn callee_is_hook(callee: &Place) -> bool {
    crate::passes::infer_reactive_places::get_hook_kind(&callee.identifier).is_some()
}

#[allow(unused_imports)]
use {JsxTag as _JsxTag, MemoDependencyRoot as _MemoDependencyRoot};
