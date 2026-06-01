//! `createControlDominators` + the post-dominator machinery it needs — ports of
//! `Inference/ControlDominators.ts` and the `computePostDominatorTree` path of
//! `HIR/Dominator.ts`.
//!
//! A block is "reactively controlled" if some block on its post-dominator
//! frontier branches (via `if`/`branch`/`switch`) on a place the caller deems
//! reactive. [`infer_reactive_places`](super::infer_reactive_places) uses this to
//! mark phis in conditionally-executed blocks reactive.
//!
//! Because the reactive predicate changes across fixpoint iterations, this caches
//! only the (immutable) post-dominator frontier per block; the reactive test of
//! each frontier block is re-evaluated against the current reactive set on every
//! query (the TS recomputes the same way via the live `isReactive` closure).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use crate::hir::ids::BlockId;
use crate::hir::model::HirFunction;
use crate::hir::terminal::Terminal;

use super::cfg::each_terminal_successor;
use super::infer_reactive_places::ReactivityMap;

/// `ControlDominators` — the `createControlDominators` closure, reified.
pub struct ControlDominators {
    /// Immediate post-dominator of each block (the `PostDominator.#nodes` map).
    post_dominators: HashMap<BlockId, BlockId>,
    /// Predecessors of each block (a copy of `block.preds`, in insertion order).
    preds: HashMap<BlockId, Vec<BlockId>>,
    /// Per-block post-dominator frontier cache (`postDominatorFrontierCache`).
    frontier_cache: RefCell<HashMap<BlockId, Vec<BlockId>>>,
    /// The set of all block ids (for frontier membership tests).
    block_ids: Vec<BlockId>,
}

impl ControlDominators {
    /// `createControlDominators(fn, isControlVariable)` — minus the live predicate,
    /// which is supplied per-query in [`is_reactive_controlled_block`].
    pub fn new(func: &HirFunction) -> Self {
        let post_dominators = compute_post_dominator_tree(func);
        let mut preds = HashMap::new();
        let mut block_ids = Vec::new();
        for block in func.body.blocks() {
            block_ids.push(block.id);
            preds.insert(block.id, block.preds.iter().copied().collect::<Vec<_>>());
        }
        ControlDominators {
            post_dominators,
            preds,
            frontier_cache: RefCell::new(HashMap::new()),
            block_ids,
        }
    }

    /// `isControlledBlock(id)`: whether some block on `id`'s post-dominator
    /// frontier branches on a place currently considered reactive.
    pub(crate) fn is_reactive_controlled_block(
        &self,
        func: &mut HirFunction,
        id: BlockId,
        reactive: &mut ReactivityMap,
    ) -> bool {
        let control_blocks = self.frontier(id);
        for &block_id in &control_blocks {
            // Read the terminal test place(s) and query reactivity. The test is a
            // *read* (no semantic mutation), but `isReactive` may set the place's
            // `reactive` flag — matching the TS, which queries via the live place.
            let kind = terminal_test_kind(func, block_id);
            match kind {
                TestKind::Single => {
                    if test_is_reactive_single(func, block_id, reactive) {
                        return true;
                    }
                }
                TestKind::Switch(case_count) => {
                    if test_is_reactive_single(func, block_id, reactive) {
                        return true;
                    }
                    for case in 0..case_count {
                        if switch_case_test_is_reactive(func, block_id, case, reactive) {
                            return true;
                        }
                    }
                }
                TestKind::None => {}
            }
        }
        false
    }

    /// `postDominatorFrontier(fn, postDominators, targetId)`, memoized.
    fn frontier(&self, target: BlockId) -> Vec<BlockId> {
        if let Some(cached) = self.frontier_cache.borrow().get(&target) {
            return cached.clone();
        }
        let frontier = self.compute_frontier(target);
        self.frontier_cache
            .borrow_mut()
            .insert(target, frontier.clone());
        frontier
    }

    fn compute_frontier(&self, target: BlockId) -> Vec<BlockId> {
        let target_post_dominators = self.post_dominators_of(target);
        let mut visited: HashSet<BlockId> = HashSet::new();
        let mut frontier: Vec<BlockId> = Vec::new();
        let mut to_visit: Vec<BlockId> = target_post_dominators.iter().copied().collect();
        to_visit.push(target);
        for block_id in to_visit {
            if !visited.insert(block_id) {
                continue;
            }
            if let Some(preds) = self.preds.get(&block_id) {
                for &pred in preds {
                    if !target_post_dominators.contains(&pred) && !frontier.contains(&pred) {
                        frontier.push(pred);
                    }
                }
            }
        }
        frontier
    }

    /// `postDominatorsOf(fn, postDominators, targetId)`.
    fn post_dominators_of(&self, target: BlockId) -> HashSet<BlockId> {
        let mut result: HashSet<BlockId> = HashSet::new();
        let mut visited: HashSet<BlockId> = HashSet::new();
        let mut queue: std::collections::VecDeque<BlockId> = std::collections::VecDeque::new();
        queue.push_back(target);
        while let Some(current) = queue.pop_front() {
            if !visited.insert(current) {
                continue;
            }
            if let Some(preds) = self.preds.get(&current) {
                for &pred in preds {
                    let pred_post_dominator = self.post_dominators.get(&pred).copied().unwrap_or(pred);
                    if pred_post_dominator == target || result.contains(&pred_post_dominator) {
                        result.insert(pred);
                    }
                    queue.push_back(pred);
                }
            }
        }
        result
    }

    #[allow(dead_code)]
    fn all_blocks(&self) -> &[BlockId] {
        &self.block_ids
    }
}

/// What kind of test a block's terminal carries.
enum TestKind {
    None,
    Single,
    Switch(usize),
}

fn terminal_test_kind(func: &HirFunction, block_id: BlockId) -> TestKind {
    match &func.body.block(block_id).expect("block").terminal {
        Terminal::If { .. } | Terminal::Branch { .. } => TestKind::Single,
        Terminal::Switch { cases, .. } => TestKind::Switch(cases.len()),
        _ => TestKind::None,
    }
}

fn test_is_reactive_single(
    func: &mut HirFunction,
    block_id: BlockId,
    reactive: &mut ReactivityMap,
) -> bool {
    let block = func.body.block_mut(block_id).expect("block");
    match &mut block.terminal {
        Terminal::If { test, .. } | Terminal::Branch { test, .. } | Terminal::Switch { test, .. } => {
            reactive.is_reactive(test)
        }
        _ => false,
    }
}

fn switch_case_test_is_reactive(
    func: &mut HirFunction,
    block_id: BlockId,
    case_index: usize,
    reactive: &mut ReactivityMap,
) -> bool {
    let block = func.body.block_mut(block_id).expect("block");
    if let Terminal::Switch { cases, .. } = &mut block.terminal
        && let Some(case) = cases.get_mut(case_index)
        && let Some(test) = &mut case.test
    {
        return reactive.is_reactive(test);
    }
    false
}

/// `computeUnconditionalBlocks(fn)` (`HIR/ComputeUnconditionalBlocks.ts`): the
/// set of blocks always reachable from the entry block. Walks the immediate
/// post-dominator chain from the entry block until reaching the synthetic exit
/// node — every block on that chain is reached on every normally-returning
/// execution, so a hook call in such a block is unconditional. The post-dominator
/// tree is built with `includeThrowsAsExitNode: false` (hooks need only be in a
/// consistent order for normally-returning executions).
pub fn compute_unconditional_blocks(func: &HirFunction) -> HashSet<BlockId> {
    let post_dominators = compute_post_dominator_tree(func);
    let exit = synthetic_exit_id(func);
    let mut unconditional: HashSet<BlockId> = HashSet::new();
    let mut current = Some(func.body.entry);
    while let Some(block) = current {
        if block == exit {
            break;
        }
        // `CompilerError.invariant(!unconditionalBlocks.has(current))`: a repeat
        // would be a non-terminating loop. Defensively stop rather than panic.
        if !unconditional.insert(block) {
            break;
        }
        // `dominators.get(current)`: the immediate post-dominator. A block that
        // does not reach the normal exit maps to itself (see
        // `compute_post_dominator_tree`); stepping to `current` again would loop,
        // so stop. The TS `PostDominator.get` returns the exit node for blocks
        // whose idom is the exit, ending the walk.
        match post_dominators.get(&block).copied() {
            Some(next) if next != block => current = Some(next),
            _ => break,
        }
    }
    unconditional
}

/// `computePostDominatorTree(fn, {includeThrowsAsExitNode: false})`: the
/// immediate-post-dominator map. Blocks not reaching the normal exit (only flow
/// into `throw`) map to themselves.
fn compute_post_dominator_tree(func: &HirFunction) -> HashMap<BlockId, BlockId> {
    let graph = build_reverse_graph(func);
    let mut nodes = compute_immediate_dominators(&graph);
    // includeThrowsAsExitNode == false: add missing blocks mapping to themselves.
    for block in func.body.blocks() {
        nodes.entry(block.id).or_insert(block.id);
    }
    nodes
}

/// A reverse-CFG node: id, RPO index, predecessors (= forward successors + exit),
/// successors (= forward predecessors).
struct Node {
    id: BlockId,
    index: usize,
    preds: Vec<BlockId>,
    succs: Vec<BlockId>,
}

struct Graph {
    entry: BlockId,
    nodes: HashMap<BlockId, Node>,
}

/// `buildReverseGraph(fn, includeThrowsAsExitNode=false)`.
fn build_reverse_graph(func: &HirFunction) -> Graph {
    let exit_id = synthetic_exit_id(func);
    let mut nodes: HashMap<BlockId, Node> = HashMap::new();
    let mut exit_succs: Vec<BlockId> = Vec::new();

    nodes.insert(
        exit_id,
        Node {
            id: exit_id,
            index: 0,
            preds: Vec::new(),
            succs: Vec::new(),
        },
    );

    for block in func.body.blocks() {
        // preds = forward successors; succs = forward preds.
        let mut preds: Vec<BlockId> = each_terminal_successor(&block.terminal);
        dedup_preserve_order(&mut preds);
        let succs: Vec<BlockId> = block.preds.iter().copied().collect();
        let mut node = Node {
            id: block.id,
            index: 0,
            preds,
            succs,
        };
        if matches!(block.terminal, Terminal::Return { .. }) {
            if !node.preds.contains(&exit_id) {
                node.preds.push(exit_id);
            }
            exit_succs.push(block.id);
        }
        // includeThrowsAsExitNode == false → `throw` does NOT connect to exit.
        nodes.insert(block.id, node);
    }
    if let Some(exit) = nodes.get_mut(&exit_id) {
        exit.succs = exit_succs;
    }

    // RPO over the reverse graph (starting at the exit node).
    let mut visited: HashSet<BlockId> = HashSet::new();
    let mut postorder: Vec<BlockId> = Vec::new();
    let mut stack: Vec<(BlockId, usize)> = vec![(exit_id, 0)];
    // Iterative DFS that matches the recursive `visit(exit)` postorder.
    while let Some((id, succ_idx)) = stack.pop() {
        if succ_idx == 0 {
            if visited.contains(&id) {
                continue;
            }
            visited.insert(id);
        }
        let succs = nodes.get(&id).map(|n| n.succs.clone()).unwrap_or_default();
        if succ_idx < succs.len() {
            stack.push((id, succ_idx + 1));
            let next = succs[succ_idx];
            if !visited.contains(&next) {
                stack.push((next, 0));
            }
        } else {
            postorder.push(id);
        }
    }

    let mut rpo_nodes: HashMap<BlockId, Node> = HashMap::new();
    let mut index = 0usize;
    for id in postorder.into_iter().rev() {
        if let Some(mut node) = nodes.remove(&id) {
            node.index = index;
            index += 1;
            rpo_nodes.insert(id, node);
        }
    }

    Graph {
        entry: exit_id,
        nodes: rpo_nodes,
    }
}

/// `computeImmediateDominators(graph)`.
fn compute_immediate_dominators(graph: &Graph) -> HashMap<BlockId, BlockId> {
    let mut nodes: HashMap<BlockId, BlockId> = HashMap::new();
    nodes.insert(graph.entry, graph.entry);

    // Iterate in RPO (by `index`) for stable, prompt convergence — matching the
    // TS, which iterates `graph.nodes` Map in RPO insertion order.
    let mut order: Vec<BlockId> = graph.nodes.keys().copied().collect();
    order.sort_by_key(|id| graph.nodes[id].index);

    let mut changed = true;
    while changed {
        changed = false;
        for &id in &order {
            let node = &graph.nodes[&id];
            if node.id == graph.entry {
                continue;
            }
            // First processed predecessor.
            let mut new_idom: Option<BlockId> = None;
            for &pred in &node.preds {
                if nodes.contains_key(&pred) {
                    new_idom = Some(pred);
                    break;
                }
            }
            let Some(mut new_idom) = new_idom else {
                // No predecessor processed yet; skip (the TS invariant guarantees
                // one is processed, but for unreachable nodes we defer).
                continue;
            };
            for &pred in &node.preds {
                if pred == new_idom {
                    continue;
                }
                if nodes.contains_key(&pred) {
                    new_idom = intersect(pred, new_idom, graph, &nodes);
                }
            }
            if nodes.get(&id) != Some(&new_idom) {
                nodes.insert(id, new_idom);
                changed = true;
            }
        }
    }
    nodes
}

/// `intersect(a, b, graph, nodes)` — walk the two finger pointers up the
/// (partial) dominator tree until they meet, using RPO `index` comparisons.
fn intersect(
    a: BlockId,
    b: BlockId,
    graph: &Graph,
    nodes: &HashMap<BlockId, BlockId>,
) -> BlockId {
    let mut finger1 = a;
    let mut finger2 = b;
    while finger1 != finger2 {
        while graph.nodes[&finger1].index > graph.nodes[&finger2].index {
            finger1 = nodes[&finger1];
        }
        while graph.nodes[&finger2].index > graph.nodes[&finger1].index {
            finger2 = nodes[&finger2];
        }
    }
    finger1
}

/// `env.nextBlockId` analog: an id distinct from every block id (max + 1).
fn synthetic_exit_id(func: &HirFunction) -> BlockId {
    let max = func
        .body
        .blocks()
        .iter()
        .map(|b| b.id.as_u32())
        .max()
        .unwrap_or(0);
    BlockId::new(max + 1)
}

fn dedup_preserve_order(ids: &mut Vec<BlockId>) {
    let mut seen: HashSet<BlockId> = HashSet::new();
    ids.retain(|id| seen.insert(*id));
}
