//! `InferMutationAliasingRanges` — port of
//! `Inference/InferMutationAliasingRanges.ts`.
//!
//! Builds an abstract data-flow graph from the per-instruction/per-terminal
//! [`AliasingEffect`]s produced by [`super::infer_mutation_aliasing_effects`],
//! then:
//!
//! 1. Computes the `mutable_range` of every identifier by walking each mutation
//!    against the graph (`AliasingState::mutate`), in a global "when" ordering.
//! 2. Resolves each [`Place`]'s `effect` from `<unknown>` to a concrete
//!    [`Effect`] (read/store/capture/mutate?/freeze/...).
//! 3. Returns the externally-visible function effects (mutations of params/
//!    context-vars, the return-value `Create`, and capture/alias relationships).
//!
//! ## Rust-vs-TS modeling note
//!
//! In the TS, `Identifier` is shared by reference, so mutating `mutableRange`
//! once is observed by every `Place` that references it. In this crate every
//! `Place` owns a *clone* of its `Identifier`, so the computed ranges are
//! tracked in a side map keyed by [`IdentifierId`] and written back to *every*
//! place (instruction lvalues/operands, phi places/operands, terminal operands,
//! and the function's `params`/`context`/`returns`) at the end. This is the only
//! structural deviation; the algorithm itself mirrors the TS line-for-line.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, IdentifierId, InstructionId};
use crate::hir::instruction::{AliasingEffect, MutationReason};
use crate::hir::model::{FunctionParam, HirFunction};
use crate::hir::place::{Effect, Identifier, MutableRange, Place, Type, ValueKind, ValueReason};
use crate::hir::terminal::Terminal;
use crate::hir::value::InstructionValue;

use super::cfg::{
    each_instruction_lvalue_mut, each_instruction_value_operand,
    each_instruction_value_operand_mut, each_terminal_operand_mut,
};

/// `MutationKind` (`InferMutationAliasingRanges.ts`). `None` is the base of the
/// `<` ordering used to decide whether to upgrade a node's mutation kind; it is
/// never constructed directly (a node starts with `local`/`transitive == None`
/// modeled as `Option::None`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum MutationKind {
    #[allow(dead_code)]
    None = 0,
    Conditional = 1,
    Definite = 2,
}

/// The `value` discriminant of a graph node (`Node['value']`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum NodeValueKind {
    Object,
    Phi,
    Function,
}

/// An outgoing edge kind (`Node['edges'][n].kind`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum EdgeKind {
    Capture,
    Alias,
    MaybeAlias,
}

/// One outgoing edge.
struct Edge {
    index: usize,
    node: IdentifierId,
    kind: EdgeKind,
}

/// A graph node (`Node`).
struct Node {
    created_from: Vec<(IdentifierId, usize)>,
    captures: Vec<(IdentifierId, usize)>,
    aliases: Vec<(IdentifierId, usize)>,
    maybe_aliases: Vec<(IdentifierId, usize)>,
    edges: Vec<Edge>,
    transitive: Option<MutationKind>,
    local: Option<MutationKind>,
    last_mutated: usize,
    mutation_reason: Option<MutationReason>,
    value: NodeValueKind,
    /// The computed mutable range for this node's identifier.
    range: MutableRange,
}

impl Node {
    fn new(value: NodeValueKind) -> Self {
        Node {
            created_from: Vec::new(),
            captures: Vec::new(),
            aliases: Vec::new(),
            maybe_aliases: Vec::new(),
            edges: Vec::new(),
            transitive: None,
            local: None,
            last_mutated: 0,
            mutation_reason: None,
            value,
            range: MutableRange::default(),
        }
    }
}

/// Insert into a "Map<Identifier, number>"-style adjacency list, mirroring
/// `if (!map.has(key)) map.set(key, index)` (first write wins).
fn map_set_if_absent(map: &mut Vec<(IdentifierId, usize)>, key: IdentifierId, index: usize) {
    if !map.iter().any(|(k, _)| *k == key) {
        map.push((key, index));
    }
}

/// `AliasingState`: the node graph keyed by identifier id, in insertion order.
struct AliasingState {
    /// Insertion-ordered node storage (we need both lookup and the absence of
    /// a node to mirror `nodes.has`/`nodes.get`).
    nodes: HashMap<IdentifierId, Node>,
}

impl AliasingState {
    fn new() -> Self {
        AliasingState {
            nodes: HashMap::new(),
        }
    }

    fn create(&mut self, id: IdentifierId, value: NodeValueKind) {
        self.nodes.insert(id, Node::new(value));
    }

    fn create_from(&mut self, index: usize, from: IdentifierId, into: IdentifierId) {
        self.create(into, NodeValueKind::Object);
        if !self.nodes.contains_key(&from) || !self.nodes.contains_key(&into) {
            return;
        }
        if let Some(from_node) = self.nodes.get_mut(&from) {
            from_node.edges.push(Edge {
                index,
                node: into,
                kind: EdgeKind::Alias,
            });
        }
        if let Some(to_node) = self.nodes.get_mut(&into) {
            map_set_if_absent(&mut to_node.created_from, from, index);
        }
    }

    fn capture(&mut self, index: usize, from: IdentifierId, into: IdentifierId) {
        if !self.nodes.contains_key(&from) || !self.nodes.contains_key(&into) {
            return;
        }
        if let Some(from_node) = self.nodes.get_mut(&from) {
            from_node.edges.push(Edge {
                index,
                node: into,
                kind: EdgeKind::Capture,
            });
        }
        if let Some(to_node) = self.nodes.get_mut(&into) {
            map_set_if_absent(&mut to_node.captures, from, index);
        }
    }

    fn assign(&mut self, index: usize, from: IdentifierId, into: IdentifierId) {
        if !self.nodes.contains_key(&from) || !self.nodes.contains_key(&into) {
            return;
        }
        if let Some(from_node) = self.nodes.get_mut(&from) {
            from_node.edges.push(Edge {
                index,
                node: into,
                kind: EdgeKind::Alias,
            });
        }
        if let Some(to_node) = self.nodes.get_mut(&into) {
            map_set_if_absent(&mut to_node.aliases, from, index);
        }
    }

    fn maybe_alias(&mut self, index: usize, from: IdentifierId, into: IdentifierId) {
        if !self.nodes.contains_key(&from) || !self.nodes.contains_key(&into) {
            return;
        }
        if let Some(from_node) = self.nodes.get_mut(&from) {
            from_node.edges.push(Edge {
                index,
                node: into,
                kind: EdgeKind::MaybeAlias,
            });
        }
        if let Some(to_node) = self.nodes.get_mut(&into) {
            map_set_if_absent(&mut to_node.maybe_aliases, from, index);
        }
    }

    /// `mutate` — propagate a mutation through the graph (BFS over edges), updating
    /// each reachable node's mutable range, `lastMutated`, and `local`/`transitive`.
    #[allow(clippy::too_many_arguments)]
    fn mutate(
        &mut self,
        index: usize,
        start: IdentifierId,
        end: Option<InstructionId>,
        transitive: bool,
        start_kind: MutationKind,
        reason: Option<MutationReason>,
    ) {
        struct Item {
            place: IdentifierId,
            transitive: bool,
            direction_backwards: bool,
            kind: MutationKind,
        }
        let mut seen: HashMap<IdentifierId, MutationKind> = HashMap::new();
        let mut queue: Vec<Item> = vec![Item {
            place: start,
            transitive,
            direction_backwards: true,
            kind: start_kind,
        }];
        while let Some(item) = queue.pop() {
            let current = item.place;
            if let Some(prev) = seen.get(&current) {
                if *prev >= item.kind {
                    continue;
                }
            }
            seen.insert(current, item.kind);
            let Some(node) = self.nodes.get_mut(&current) else {
                continue;
            };
            if node.mutation_reason.is_none() {
                node.mutation_reason = reason;
            }
            node.last_mutated = node.last_mutated.max(index);
            if let Some(end) = end {
                node.range.end =
                    InstructionId::new(node.range.end.as_u32().max(end.as_u32()));
            }
            if item.transitive {
                if node.transitive.is_none() || node.transitive.unwrap() < item.kind {
                    node.transitive = Some(item.kind);
                }
            } else if node.local.is_none() || node.local.unwrap() < item.kind {
                node.local = Some(item.kind);
            }
            let node_is_phi = node.value == NodeValueKind::Phi;

            // Forward edges.
            for edge in &node.edges {
                if edge.index >= index {
                    break;
                }
                queue.push(Item {
                    place: edge.node,
                    transitive: item.transitive,
                    direction_backwards: false,
                    kind: if edge.kind == EdgeKind::MaybeAlias {
                        MutationKind::Conditional
                    } else {
                        item.kind
                    },
                });
            }
            // Backward through createdFrom.
            for (alias, when) in &node.created_from {
                if *when >= index {
                    continue;
                }
                queue.push(Item {
                    place: *alias,
                    transitive: true,
                    direction_backwards: true,
                    kind: item.kind,
                });
            }
            if item.direction_backwards || !node_is_phi {
                for (alias, when) in &node.aliases {
                    if *when >= index {
                        continue;
                    }
                    queue.push(Item {
                        place: *alias,
                        transitive: item.transitive,
                        direction_backwards: true,
                        kind: item.kind,
                    });
                }
                for (alias, when) in &node.maybe_aliases {
                    if *when >= index {
                        continue;
                    }
                    queue.push(Item {
                        place: *alias,
                        transitive: item.transitive,
                        direction_backwards: true,
                        kind: MutationKind::Conditional,
                    });
                }
            }
            if item.transitive {
                for (capture, when) in &node.captures {
                    if *when >= index {
                        continue;
                    }
                    queue.push(Item {
                        place: *capture,
                        transitive: item.transitive,
                        direction_backwards: true,
                        kind: item.kind,
                    });
                }
            }
        }
    }
}

/// A pending mutation queued during graph construction (processed after the
/// graph is fully built).
struct PendingMutation {
    index: usize,
    id: InstructionId,
    transitive: bool,
    kind: MutationKind,
    place: IdentifierId,
    reason: Option<MutationReason>,
}

/// Place into-identifier for a [`FunctionParam`] (`param.kind === 'Identifier' ? param : param.place`).
fn param_identifier(param: &FunctionParam) -> IdentifierId {
    match param {
        FunctionParam::Place(place) => place.identifier.id,
        FunctionParam::Spread(spread) => spread.place.identifier.id,
    }
}

fn param_place_clone(param: &FunctionParam) -> Place {
    match param {
        FunctionParam::Place(place) => place.clone(),
        FunctionParam::Spread(spread) => spread.place.clone(),
    }
}

/// `inferMutationAliasingRanges(fn, {isFunctionExpression})`.
///
/// Returns the externally-visible function effects (the TS return value); the
/// caller stores them on `fn.aliasing_effects` for function expressions.
pub fn infer_mutation_aliasing_ranges(
    func: &mut HirFunction,
    is_function_expression: bool,
) -> Vec<AliasingEffect> {
    let mut function_effects: Vec<AliasingEffect> = Vec::new();
    let mut state = AliasingState::new();

    // Pending phi operands keyed by predecessor block (delayed until that block
    // has been visited).
    let mut pending_phis: Vec<(BlockId, IdentifierId, IdentifierId, usize)> = Vec::new();
    let mut mutations: Vec<PendingMutation> = Vec::new();
    let mut renders: Vec<(usize, IdentifierId)> = Vec::new();

    let returns_id = func.returns.identifier.id;

    let mut index: usize = 0;

    // Seed nodes for params, context vars, and the return value.
    for param in &func.params {
        state.create(param_identifier(param), NodeValueKind::Object);
    }
    for ctx in &func.context {
        state.create(ctx.identifier.id, NodeValueKind::Object);
    }
    state.create(returns_id, NodeValueKind::Object);

    // Iterate blocks in CFG order, building the graph.
    let mut seen_blocks: Vec<BlockId> = Vec::new();
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block(block_id).expect("block exists");
        // Snapshot the data we need (immutable borrow of the block) before
        // mutating `state`.
        let block_id = block.id;

        // Phis.
        let phis: Vec<(IdentifierId, Vec<(BlockId, IdentifierId)>)> = block
            .phis
            .iter()
            .map(|phi| {
                (
                    phi.place.identifier.id,
                    phi.operands
                        .iter()
                        .map(|(pred, place)| (*pred, place.identifier.id))
                        .collect(),
                )
            })
            .collect();
        for (phi_place, operands) in &phis {
            state.create(*phi_place, NodeValueKind::Phi);
            for (pred, operand) in operands {
                if !seen_blocks.contains(pred) {
                    pending_phis.push((*pred, *operand, *phi_place, index));
                    index += 1;
                } else {
                    state.assign(index, *operand, *phi_place);
                    index += 1;
                }
            }
        }
        seen_blocks.push(block_id);

        // Instruction effects.
        let block = func.body.block(block_id).expect("block exists");
        let instr_effects: Vec<(InstructionId, Vec<AliasingEffect>)> = block
            .instructions
            .iter()
            .map(|instr| {
                (
                    instr.id,
                    instr.effects.clone().unwrap_or_default(),
                )
            })
            .collect();
        let terminal_kind_return = matches!(block.terminal, Terminal::Return { .. });
        let terminal_value_id = match &block.terminal {
            Terminal::Return { value, .. } => Some(value.identifier.id),
            _ => None,
        };
        let terminal_effects: Option<Vec<AliasingEffect>> = match &block.terminal {
            Terminal::Return { effects, .. } | Terminal::MaybeThrow { effects, .. } => {
                effects.clone()
            }
            _ => None,
        };

        for (instr_id, effects) in &instr_effects {
            for effect in effects {
                match effect {
                    AliasingEffect::Create { into, .. } => {
                        state.create(into.identifier.id, NodeValueKind::Object);
                    }
                    AliasingEffect::CreateFunction { into, .. } => {
                        state.create(into.identifier.id, NodeValueKind::Function);
                    }
                    AliasingEffect::CreateFrom { from, into } => {
                        state.create_from(index, from.identifier.id, into.identifier.id);
                        index += 1;
                    }
                    AliasingEffect::Assign { from, into } => {
                        if !state.nodes.contains_key(&into.identifier.id) {
                            state.create(into.identifier.id, NodeValueKind::Object);
                        }
                        state.assign(index, from.identifier.id, into.identifier.id);
                        index += 1;
                    }
                    AliasingEffect::Alias { from, into } => {
                        state.assign(index, from.identifier.id, into.identifier.id);
                        index += 1;
                    }
                    AliasingEffect::MaybeAlias { from, into } => {
                        state.maybe_alias(index, from.identifier.id, into.identifier.id);
                        index += 1;
                    }
                    AliasingEffect::Capture { from, into } => {
                        state.capture(index, from.identifier.id, into.identifier.id);
                        index += 1;
                    }
                    AliasingEffect::MutateTransitive { value }
                    | AliasingEffect::MutateTransitiveConditionally { value } => {
                        mutations.push(PendingMutation {
                            index,
                            id: *instr_id,
                            transitive: true,
                            kind: if matches!(effect, AliasingEffect::MutateTransitive { .. }) {
                                MutationKind::Definite
                            } else {
                                MutationKind::Conditional
                            },
                            reason: None,
                            place: value.identifier.id,
                        });
                        index += 1;
                    }
                    AliasingEffect::Mutate { value, reason } => {
                        mutations.push(PendingMutation {
                            index,
                            id: *instr_id,
                            transitive: false,
                            kind: MutationKind::Definite,
                            reason: *reason,
                            place: value.identifier.id,
                        });
                        index += 1;
                    }
                    AliasingEffect::MutateConditionally { value } => {
                        mutations.push(PendingMutation {
                            index,
                            id: *instr_id,
                            transitive: false,
                            kind: MutationKind::Conditional,
                            reason: None,
                            place: value.identifier.id,
                        });
                        index += 1;
                    }
                    AliasingEffect::MutateFrozen { .. }
                    | AliasingEffect::MutateGlobal { .. }
                    | AliasingEffect::Impure { .. } => {
                        function_effects.push(effect.clone());
                    }
                    AliasingEffect::Render { place } => {
                        renders.push((index, place.identifier.id));
                        index += 1;
                        function_effects.push(effect.clone());
                    }
                    _ => {}
                }
            }
        }

        // Pending phis whose predecessor is this block.
        let block_pending: Vec<(IdentifierId, IdentifierId, usize)> = pending_phis
            .iter()
            .filter(|(pred, _, _, _)| *pred == block_id)
            .map(|(_, from, into, idx)| (*from, *into, *idx))
            .collect();
        for (from, into, idx) in block_pending {
            state.assign(idx, from, into);
        }

        // Return terminal: assign value -> returns.
        if let Some(value_id) = terminal_value_id {
            state.assign(index, value_id, returns_id);
            index += 1;
        }

        // Maybe-throw / return terminal effects.
        if (terminal_kind_return || terminal_effects.is_some())
            && let Some(effects) = &terminal_effects
        {
            for effect in effects {
                if let AliasingEffect::Alias { from, into } = effect {
                    state.assign(index, from.identifier.id, into.identifier.id);
                    index += 1;
                }
                // Non-Alias effects on these terminals must be Freeze (a no-op
                // for range construction); the TS asserts this invariant.
            }
        }
    }

    // Apply queued mutations against the fully-built graph.
    for mutation in &mutations {
        state.mutate(
            mutation.index,
            mutation.place,
            Some(InstructionId::new(mutation.id.as_u32() + 1)),
            mutation.transitive,
            mutation.kind,
            mutation.reason,
        );
    }
    // Renders only matter for validation (no range effect); skip the walk.
    let _ = &renders;

    // Bubble up context-var / param mutations as externally-visible effects, and
    // mark the corresponding place as Capture.
    let mut captured_params: HashSet<IdentifierId> = HashSet::new();
    let context_places: Vec<Place> = func.context.to_vec();
    for place in &context_places {
        bubble_up_mutation(&state, place, &mut function_effects, &mut captured_params);
    }
    let param_places: Vec<Place> = func.params.iter().map(param_place_clone).collect();
    for place in &param_places {
        bubble_up_mutation(&state, place, &mut function_effects, &mut captured_params);
    }

    // The bubble-up sets `place.effect = Capture` on the mutated param/context
    // header place (TS line 301).
    for ctx in &mut func.context {
        if captured_params.contains(&ctx.identifier.id) {
            ctx.effect = Effect::Capture;
        }
    }
    for param in &mut func.params {
        let place = match param {
            FunctionParam::Place(p) => p,
            FunctionParam::Spread(s) => &mut s.place,
        };
        if captured_params.contains(&place.identifier.id) {
            place.effect = Effect::Capture;
        }
    }

    // ---- Part 2: assign concrete place effects + fix up ranges. ----
    // First, finalize each node's range (Part 2 also writes lvalue/operand range
    // fixups into the graph ranges, so we operate against `state.nodes` ranges
    // and then write back to every place at the end).
    finalize_place_effects(func, &mut state, is_function_expression);

    // ---- Part 3: return-value Create + transitive capture analysis. ----
    let returns_type = func.returns.identifier.type_.clone();
    let returns_is_primitive = matches!(returns_type, Type::Primitive);
    let returns_is_jsx = is_jsx_type(&returns_type);
    function_effects.push(AliasingEffect::Create {
        into: func.returns.clone(),
        value: if returns_is_primitive {
            ValueKind::Primitive
        } else if returns_is_jsx {
            ValueKind::Frozen
        } else {
            ValueKind::Mutable
        },
        reason: ValueReason::KnownReturnSignature,
    });

    // Tracked = params ++ context ++ returns.
    let mut tracked: Vec<Place> = Vec::new();
    for param in &func.params {
        tracked.push(param_place_clone(param));
    }
    for ctx in &func.context {
        tracked.push(ctx.clone());
    }
    tracked.push(func.returns.clone());

    for into in &tracked {
        let mutation_index = index;
        index += 1;
        state.mutate(
            mutation_index,
            into.identifier.id,
            None,
            true,
            MutationKind::Conditional,
            None,
        );
        for from in &tracked {
            if from.identifier.id == into.identifier.id || from.identifier.id == returns_id {
                continue;
            }
            let Some(from_node) = state.nodes.get(&from.identifier.id) else {
                continue;
            };
            if from_node.last_mutated == mutation_index {
                if into.identifier.id == returns_id {
                    function_effects.push(AliasingEffect::Alias {
                        from: from.clone(),
                        into: into.clone(),
                    });
                } else {
                    function_effects.push(AliasingEffect::Capture {
                        from: from.clone(),
                        into: into.clone(),
                    });
                }
            }
        }
    }

    // Write the finalized ranges back to params / context / returns places too.
    write_back_outer_ranges(func, &state);

    function_effects
}

/// Bubble up a single param/context-var's mutation state into the function
/// effects, and set `place.effect = Capture` (TS Part 3 prelude, lines 261-303).
/// We only push function effects here; the place's effect is set on the outer
/// `func.context` later in `write_back_outer_ranges` via `captured_params`.
fn bubble_up_mutation(
    state: &AliasingState,
    place: &Place,
    function_effects: &mut Vec<AliasingEffect>,
    captured_params: &mut HashSet<IdentifierId>,
) {
    let Some(node) = state.nodes.get(&place.identifier.id) else {
        return;
    };
    let mut mutated = false;
    if let Some(local) = node.local {
        if local == MutationKind::Conditional {
            mutated = true;
            function_effects.push(AliasingEffect::MutateConditionally {
                value: place.clone(),
            });
        } else if local == MutationKind::Definite {
            mutated = true;
            function_effects.push(AliasingEffect::Mutate {
                value: place.clone(),
                reason: node.mutation_reason,
            });
        }
    }
    if let Some(transitive) = node.transitive {
        if transitive == MutationKind::Conditional {
            mutated = true;
            function_effects.push(AliasingEffect::MutateTransitiveConditionally {
                value: place.clone(),
            });
        } else if transitive == MutationKind::Definite {
            mutated = true;
            function_effects.push(AliasingEffect::MutateTransitive {
                value: place.clone(),
            });
        }
    }
    if mutated {
        captured_params.insert(place.identifier.id);
    }
}

/// Part 2: assign concrete place effects based on instruction effects + the
/// computed mutable ranges, fixing up ranges where needed. Operates against the
/// graph node ranges (the source of truth) and writes the resolved effect +
/// range onto every place.
fn finalize_place_effects(
    func: &mut HirFunction,
    state: &mut AliasingState,
    is_function_expression: bool,
) {
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        // ---- Phis ----
        // Snapshot first-instruction id / terminal id for the block.
        let (first_instr_id, phi_count) = {
            let block = func.body.block(block_id).expect("block exists");
            let first = block
                .instructions
                .first()
                .map(|i| i.id)
                .unwrap_or_else(|| block.terminal.id());
            (first, block.phis.len())
        };
        for phi_index in 0..phi_count {
            let phi_place_id = {
                let block = func.body.block(block_id).expect("block exists");
                block.phis[phi_index].place.identifier.id
            };
            let phi_end = node_range(state, phi_place_id).end;
            let is_phi_mutated_after_creation = phi_end.as_u32() > first_instr_id.as_u32();
            // Fixup phi range start.
            if is_phi_mutated_after_creation
                && node_range(state, phi_place_id).start.as_u32() == 0
            {
                let new_start = InstructionId::new(first_instr_id.as_u32().saturating_sub(1));
                if let Some(n) = state.nodes.get_mut(&phi_place_id) {
                    n.range.start = new_start;
                }
            }
            let phi_range = node_range(state, phi_place_id);
            // Write phi place + operand effects/ranges.
            let block = func.body.block_mut(block_id).expect("block exists");
            let phi = &mut block.phis[phi_index];
            phi.place.effect = Effect::Store;
            set_range(&mut phi.place.identifier, phi_range);
            let operand_effect = if is_phi_mutated_after_creation {
                Effect::Capture
            } else {
                Effect::Read
            };
            for operand in phi.operands.values_mut() {
                operand.effect = operand_effect;
            }
        }

        // ---- Instructions ----
        let instr_count = func.body.block(block_id).expect("block").instructions.len();
        for i in 0..instr_count {
            // Snapshot the data we need from the instruction.
            let (instr_id, effects, lvalue_ids, operand_ids, is_store_context, store_context_value_id) = {
                let block = func.body.block(block_id).expect("block exists");
                let instr = &block.instructions[i];
                let lvalue_ids: Vec<IdentifierId> = each_instruction_lvalue_ids(instr);
                let operand_ids: Vec<IdentifierId> =
                    each_instruction_value_operand(&instr.value)
                        .iter()
                        .map(|p| p.identifier.id)
                        .collect();
                let is_store_context =
                    matches!(instr.value, InstructionValue::StoreContext { .. });
                let store_context_value_id = match &instr.value {
                    InstructionValue::StoreContext { value, .. } => Some(value.identifier.id),
                    _ => None,
                };
                (
                    instr.id,
                    instr.effects.clone().unwrap_or_default(),
                    lvalue_ids,
                    operand_ids,
                    is_store_context,
                    store_context_value_id,
                )
            };

            // Default lvalue range fixups (TS lines 341-351). These run even if
            // `instr.effects == null`.
            for lid in &lvalue_ids {
                let r = node_range_or_default(state, *lid);
                let mut start = r.start;
                let mut end = r.end;
                if start.as_u32() == 0 {
                    start = instr_id;
                }
                if end.as_u32() == 0 {
                    end = InstructionId::new((instr_id.as_u32() + 1).max(end.as_u32()));
                }
                set_node_range(state, *lid, MutableRange { start, end });
            }

            // Build operandEffects from the instruction effects.
            let mut operand_effects: HashMap<IdentifierId, Effect> = HashMap::new();
            for effect in &effects {
                match effect {
                    AliasingEffect::Assign { from, into }
                    | AliasingEffect::Alias { from, into }
                    | AliasingEffect::Capture { from, into }
                    | AliasingEffect::CreateFrom { from, into }
                    | AliasingEffect::MaybeAlias { from, into } => {
                        let into_end = node_range_or_default(state, into.identifier.id).end;
                        let is_mutated_or_reassigned = into_end.as_u32() > instr_id.as_u32();
                        if is_mutated_or_reassigned {
                            operand_effects.insert(from.identifier.id, Effect::Capture);
                        } else {
                            operand_effects.insert(from.identifier.id, Effect::Read);
                        }
                        operand_effects.insert(into.identifier.id, Effect::Store);
                    }
                    AliasingEffect::Create { .. } | AliasingEffect::CreateFunction { .. } => {}
                    AliasingEffect::Mutate { value, .. } => {
                        operand_effects.insert(value.identifier.id, Effect::Store);
                    }
                    AliasingEffect::MutateTransitive { value }
                    | AliasingEffect::MutateConditionally { value }
                    | AliasingEffect::MutateTransitiveConditionally { value } => {
                        operand_effects
                            .insert(value.identifier.id, Effect::ConditionallyMutate);
                    }
                    AliasingEffect::Freeze { value, .. } => {
                        operand_effects.insert(value.identifier.id, Effect::Freeze);
                    }
                    // ImmutableCapture / Impure / Render / MutateFrozen / MutateGlobal: no-op.
                    _ => {}
                }
            }

            // Operand range fixups (TS lines 429-435): if operand is mutated after
            // this instr and start==0, set start to instr id.
            for oid in &operand_ids {
                let r = node_range_or_default(state, *oid);
                if r.end.as_u32() > instr_id.as_u32() && r.start.as_u32() == 0 {
                    set_node_range(
                        state,
                        *oid,
                        MutableRange {
                            start: instr_id,
                            end: r.end,
                        },
                    );
                }
            }

            // StoreContext hoisted-function fixup (TS lines 464-471).
            if is_store_context {
                if let Some(vid) = store_context_value_id {
                    let r = node_range_or_default(state, vid);
                    if r.end.as_u32() <= instr_id.as_u32() {
                        set_node_range(
                            state,
                            vid,
                            MutableRange {
                                start: r.start,
                                end: InstructionId::new(instr_id.as_u32() + 1),
                            },
                        );
                    }
                }
            }

            // Now write effects + ranges to the actual places.
            let has_effects = {
                let block = func.body.block(block_id).expect("block exists");
                block.instructions[i].effects.is_some()
            };
            let block = func.body.block_mut(block_id).expect("block exists");
            let instr = &mut block.instructions[i];
            // lvalues
            for lvalue in each_instruction_lvalue_mut(instr) {
                let eff = if has_effects {
                    operand_effects
                        .get(&lvalue.identifier.id)
                        .copied()
                        .unwrap_or(Effect::ConditionallyMutate)
                } else {
                    Effect::ConditionallyMutate
                };
                lvalue.effect = eff;
            }
            // operands
            for operand in each_instruction_value_operand_mut(&mut instr.value) {
                let eff = if has_effects {
                    operand_effects
                        .get(&operand.identifier.id)
                        .copied()
                        .unwrap_or(Effect::Read)
                } else {
                    Effect::Read
                };
                operand.effect = eff;
            }
        }

        // ---- Terminal operands ----
        let is_return = matches!(
            func.body.block(block_id).expect("block").terminal,
            Terminal::Return { .. }
        );
        let block = func.body.block_mut(block_id).expect("block exists");
        if is_return {
            if let Terminal::Return { value, .. } = &mut block.terminal {
                value.effect = if is_function_expression {
                    Effect::Read
                } else {
                    Effect::Freeze
                };
            }
        } else {
            for operand in each_terminal_operand_mut(&mut block.terminal) {
                operand.effect = Effect::Read;
            }
        }
    }

    // After ranges are finalized in the graph, write them onto every place that
    // references each identifier (instruction lvalues/operands, phi places/
    // operands, terminal operands).
    write_back_all_ranges(func, state);
}

/// The lvalue identifier ids of an instruction, in `eachInstructionLValue` order.
fn each_instruction_lvalue_ids(instr: &crate::hir::instruction::Instruction) -> Vec<IdentifierId> {
    let mut out = vec![instr.lvalue.identifier.id];
    for p in each_instruction_value_lvalue(&instr.value) {
        out.push(p.identifier.id);
    }
    out
}

/// The value-level lvalue places of an instruction (`eachInstructionValueLValue`),
/// non-mutating.
fn each_instruction_value_lvalue(value: &InstructionValue) -> Vec<&Place> {
    let mut out: Vec<&Place> = Vec::new();
    match value {
        InstructionValue::DeclareContext { place, .. } => out.push(place),
        InstructionValue::StoreContext { place, .. } => out.push(place),
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => out.push(&lvalue.place),
        InstructionValue::Destructure { lvalue, .. } => {
            push_pattern_operands(&mut out, &lvalue.pattern);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => out.push(lvalue),
        _ => {}
    }
    out
}

fn push_pattern_operands<'a>(out: &mut Vec<&'a Place>, pattern: &'a crate::hir::value::Pattern) {
    use crate::hir::value::{ArrayPatternItem, ObjectPatternProperty, Pattern};
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
}

fn node_range(state: &AliasingState, id: IdentifierId) -> MutableRange {
    state
        .nodes
        .get(&id)
        .map(|n| n.range)
        .unwrap_or_default()
}

/// Like [`node_range`] but returns the default range when there is no node
/// (mirrors the TS reading `identifier.mutableRange` which is always present).
fn node_range_or_default(state: &AliasingState, id: IdentifierId) -> MutableRange {
    node_range(state, id)
}

fn set_node_range(state: &mut AliasingState, id: IdentifierId, range: MutableRange) {
    if let Some(node) = state.nodes.get_mut(&id) {
        node.range = range;
    } else {
        // Identifiers without a graph node (e.g. globals never aliased) still
        // need range tracking for write-back; create a transient holder.
        let mut node = Node::new(NodeValueKind::Object);
        node.range = range;
        state.nodes.insert(id, node);
    }
}

fn set_range(identifier: &mut Identifier, range: MutableRange) {
    identifier.mutable_range = range;
}

/// Write the finalized ranges from the graph back onto every place referencing
/// each identifier id.
///
/// This also recurses into nested `FunctionExpression`/`ObjectMethod` bodies:
/// in the TS, identifiers are shared by reference, so when the outer pass
/// recomputes the range of a context var (e.g. `a$1`) that a nested function
/// captures and reads, the nested body's operand observes the new range too.
/// Here places own their identifiers, so we walk into nested bodies and update
/// any place whose identifier the graph tracks (`write_back_place` is a no-op
/// for ids without a node, leaving nested-only locals untouched).
fn write_back_all_ranges(func: &mut HirFunction, state: &AliasingState) {
    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for phi in &mut block.phis {
            write_back_place(&mut phi.place, state);
            for operand in phi.operands.values_mut() {
                write_back_place(operand, state);
            }
        }
        for instr in &mut block.instructions {
            for p in each_instruction_lvalue_mut(instr) {
                write_back_place(p, state);
            }
            for p in each_instruction_value_operand_mut(&mut instr.value) {
                write_back_place(p, state);
            }
            // Recurse into nested function bodies (shared-identifier semantics).
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    write_back_nested(&mut lowered_func.func, state);
                }
                _ => {}
            }
        }
        for p in each_terminal_operand_mut(&mut block.terminal) {
            write_back_place(p, state);
        }
        // The Return value place is not in eachTerminalOperand; handle it.
        if let Terminal::Return { value, .. } = &mut block.terminal {
            write_back_place(value, state);
        }
    }
}

/// Recursively write back outer-tracked ranges into a nested function's bodies
/// and its `context`/`params`/`returns` header places.
fn write_back_nested(func: &mut HirFunction, state: &AliasingState) {
    for param in &mut func.params {
        match param {
            FunctionParam::Place(place) => write_back_place(place, state),
            FunctionParam::Spread(spread) => write_back_place(&mut spread.place, state),
        }
    }
    for ctx in &mut func.context {
        write_back_place(ctx, state);
    }
    write_back_place(&mut func.returns, state);
    write_back_all_ranges(func, state);
}

/// Write the finalized ranges onto the function's params/context/returns.
fn write_back_outer_ranges(func: &mut HirFunction, state: &AliasingState) {
    for param in &mut func.params {
        match param {
            FunctionParam::Place(place) => write_back_place(place, state),
            FunctionParam::Spread(spread) => write_back_place(&mut spread.place, state),
        }
    }
    for ctx in &mut func.context {
        write_back_place(ctx, state);
    }
    write_back_place(&mut func.returns, state);
}

fn write_back_place(place: &mut Place, state: &AliasingState) {
    if let Some(node) = state.nodes.get(&place.identifier.id) {
        place.identifier.mutable_range = node.range;
    }
}

fn is_jsx_type(type_: &Type) -> bool {
    matches!(type_, Type::Object { shape_id: Some(s) } if s == "BuiltInJsx")
}
