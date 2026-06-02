//! Top-level HIR aggregates: [`HirFunction`], the [`Hir`] control-flow graph,
//! [`BasicBlock`], and [`Phi`] (`HIR/HIR.ts`).

use std::collections::BTreeMap;

use super::SourceLocation;
use super::ids::BlockId;
use super::instruction::{AliasingEffect, Instruction};
use super::place::Place;
use super::terminal::Terminal;
use super::value::SpreadPattern;

/// An insertion-ordered map from predecessor [`BlockId`] to its incoming
/// [`Place`], the Rust analog of the JavaScript `Map<BlockId, Place>` used for
/// [`Phi::operands`].
///
/// `PrintHIR.printPhi` iterates `phi.operands` in JS `Map` insertion order — the
/// order `addPhi` walked `block.preds` — *not* numerically. Predecessor order is
/// not always numeric (e.g. `predecessor blocks: bb3 bb1`), so a `BTreeMap` would
/// reorder the operands and break parity. This type preserves first-insertion
/// order while deduplicating, matching JS `Map` semantics. A re-`insert` of an
/// existing key overwrites the value in place (like `Map.set`); a `remove`
/// followed by an `insert` (as the merge/prune remap passes do) appends the key
/// at the end, also matching JS.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PhiOperands {
    entries: Vec<(BlockId, Place)>,
}

impl PhiOperands {
    /// An empty operand map.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Insert or overwrite the operand for `block`. A new key is appended
    /// (preserving insertion order); an existing key keeps its position and has
    /// its value replaced, matching `Map.set`.
    pub fn insert(&mut self, block: BlockId, place: Place) -> Option<Place> {
        if let Some(entry) = self.entries.iter_mut().find(|(id, _)| *id == block) {
            Some(std::mem::replace(&mut entry.1, place))
        } else {
            self.entries.push((block, place));
            None
        }
    }

    /// Remove and return the operand for `block`, preserving the order of the
    /// remaining entries (`Map.delete` plus the prior `Map.get`).
    pub fn remove(&mut self, block: &BlockId) -> Option<Place> {
        if let Some(pos) = self.entries.iter().position(|(id, _)| id == block) {
            Some(self.entries.remove(pos).1)
        } else {
            None
        }
    }

    /// The operand for `block`, if present.
    pub fn get(&self, block: &BlockId) -> Option<&Place> {
        self.entries
            .iter()
            .find(|(id, _)| id == block)
            .map(|(_, place)| place)
    }

    /// The number of operands.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True if there are no operands.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterate `(block, place)` pairs in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = (&BlockId, &Place)> {
        self.entries.iter().map(|(id, place)| (id, place))
    }

    /// The predecessor block ids in insertion order.
    pub fn keys(&self) -> impl Iterator<Item = &BlockId> {
        self.entries.iter().map(|(id, _)| id)
    }

    /// The operand places in insertion order.
    pub fn values(&self) -> impl Iterator<Item = &Place> {
        self.entries.iter().map(|(_, place)| place)
    }

    /// Mutable access to the operand places in insertion order.
    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut Place> {
        self.entries.iter_mut().map(|(_, place)| place)
    }
}

/// An insertion-ordered set of [`BlockId`]s, the Rust analog of a JavaScript
/// `Set<BlockId>`.
///
/// `PrintHIR` prints a block's `predecessor blocks:` in the order
/// `markPredecessors` discovered them during its depth-first walk — *not*
/// sorted — so a `BTreeSet` would reorder them and break parity. This type
/// preserves first-insertion order while deduplicating, matching JS `Set`
/// semantics for the operations lowering needs.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BlockSet {
    ids: Vec<BlockId>,
}

impl BlockSet {
    /// An empty set.
    pub fn new() -> Self {
        Self { ids: Vec::new() }
    }

    /// Insert `id`, preserving first-insertion order. Returns `true` if newly
    /// inserted (matching `Set.add` plus a membership check).
    pub fn insert(&mut self, id: BlockId) -> bool {
        if self.ids.contains(&id) {
            false
        } else {
            self.ids.push(id);
            true
        }
    }

    /// True if `id` is present.
    pub fn contains(&self, id: &BlockId) -> bool {
        self.ids.contains(id)
    }

    /// Remove `id` if present, preserving the order of the remaining ids.
    pub fn remove(&mut self, id: &BlockId) -> bool {
        if let Some(pos) = self.ids.iter().position(|x| x == id) {
            self.ids.remove(pos);
            true
        } else {
            false
        }
    }

    /// Remove all ids.
    pub fn clear(&mut self) {
        self.ids.clear();
    }

    /// The number of ids.
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    /// True if empty.
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Iterate the ids in insertion order.
    pub fn iter(&self) -> std::slice::Iter<'_, BlockId> {
        self.ids.iter()
    }
}

impl<'a> IntoIterator for &'a BlockSet {
    type Item = &'a BlockId;
    type IntoIter = std::slice::Iter<'a, BlockId>;

    fn into_iter(self) -> Self::IntoIter {
        self.ids.iter()
    }
}

impl FromIterator<BlockId> for BlockSet {
    fn from_iter<I: IntoIterator<Item = BlockId>>(iter: I) -> Self {
        let mut set = BlockSet::new();
        for id in iter {
            set.insert(id);
        }
        set
    }
}

/// Whether a React function is a component, a hook, or neither
/// (`ReactFunctionType` from `Environment`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReactFunctionType {
    /// A React component.
    Component,
    /// A React hook.
    Hook,
    /// Any other function.
    Other,
}

impl ReactFunctionType {
    /// The string spelling used by `PrintHIR` for the function header.
    pub fn as_str(self) -> &'static str {
        match self {
            ReactFunctionType::Component => "component",
            ReactFunctionType::Hook => "hook",
            ReactFunctionType::Other => "other",
        }
    }
}

/// A function parameter: a [`Place`] or a `...rest` [`SpreadPattern`]
/// (`Array<Place | SpreadPattern>`).
#[derive(Clone, Debug, PartialEq)]
pub enum FunctionParam {
    /// A positional parameter.
    Place(Place),
    /// A `...rest` parameter.
    Spread(SpreadPattern),
}

/// The kind of a [`BasicBlock`] (`BlockKind` in `HIR/HIR.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockKind {
    /// Statement block (`BlockStatement`, etc.).
    Block,
    /// Expression value block (`ConditionalExpression`, etc.).
    Value,
    /// Loop initializer/test/updater block.
    Loop,
    /// Expression sequence block.
    Sequence,
    /// `catch` clause block.
    Catch,
}

impl BlockKind {
    /// The string spelling used by `PrintHIR`.
    pub fn as_str(self) -> &'static str {
        match self {
            BlockKind::Block => "block",
            BlockKind::Value => "value",
            BlockKind::Loop => "loop",
            BlockKind::Sequence => "sequence",
            BlockKind::Catch => "catch",
        }
    }

    /// True for `block`/`catch` (statement blocks); inverse of
    /// [`BlockKind::is_expression`] (`isStatementBlockKind`).
    pub fn is_statement(self) -> bool {
        matches!(self, BlockKind::Block | BlockKind::Catch)
    }

    /// True for `value`/`loop`/`sequence` (expression blocks)
    /// (`isExpressionBlockKind`).
    pub fn is_expression(self) -> bool {
        !self.is_statement()
    }
}

/// A phi node merging values from multiple predecessor blocks (`Phi`).
/// `operands` is an insertion-ordered [`PhiOperands`] map so it prints in the
/// same predecessor order the TS JS `Map` does (see [`PhiOperands`]).
#[derive(Clone, Debug, PartialEq)]
pub struct Phi {
    /// The place the phi defines.
    pub place: Place,
    /// Per-predecessor incoming places, in insertion (predecessor) order.
    pub operands: PhiOperands,
}

/// A basic block: zero or more [`Instruction`]s followed by a [`Terminal`]
/// (`BasicBlock` in `HIR/HIR.ts`). `preds`/`phis` use ordered collections for
/// deterministic iteration. Phis are stored as a `Vec` because [`Phi`] is not
/// itself `Ord`; insertion order is preserved.
#[derive(Clone, Debug, PartialEq)]
pub struct BasicBlock {
    /// The block kind.
    pub kind: BlockKind,
    /// The block id.
    pub id: BlockId,
    /// The block's instructions in order.
    pub instructions: Vec<Instruction>,
    /// The block's terminal.
    pub terminal: Terminal,
    /// Predecessor block ids, in `markPredecessors` discovery order.
    pub preds: BlockSet,
    /// Phi nodes (insertion order preserved).
    pub phis: Vec<Phi>,
}

/// The control-flow graph of a function (`HIR` in `HIR.ts`).
///
/// Blocks are stored both as a `BlockId -> index` map (for lookup) and as an
/// ordered `Vec` (for iteration). The iteration order is reverse-postorder, the
/// order in which `PrintHIR` walks blocks, and is the insertion order produced
/// by lowering.
#[derive(Clone, Debug, PartialEq)]
pub struct Hir {
    /// The entry block id.
    pub entry: BlockId,
    /// Blocks in reverse-postorder (insertion order).
    blocks: Vec<BasicBlock>,
    /// Lookup from block id to its index in `blocks`.
    index: BTreeMap<BlockId, usize>,
}

impl Hir {
    /// A fresh, empty CFG whose entry is `entry`.
    pub fn new(entry: BlockId) -> Self {
        Hir {
            entry,
            blocks: Vec::new(),
            index: BTreeMap::new(),
        }
    }

    /// Append a block, preserving insertion (reverse-postorder) order.
    ///
    /// # Panics
    /// Panics if a block with the same id was already inserted.
    pub fn push_block(&mut self, block: BasicBlock) {
        let id = block.id;
        let position = self.blocks.len();
        assert!(
            self.index.insert(id, position).is_none(),
            "duplicate block id {id:?}"
        );
        self.blocks.push(block);
    }

    /// The blocks in iteration order.
    pub fn blocks(&self) -> &[BasicBlock] {
        &self.blocks
    }

    /// Mutable access to the blocks in iteration order.
    pub fn blocks_mut(&mut self) -> &mut [BasicBlock] {
        &mut self.blocks
    }

    /// Look up a block by id.
    pub fn block(&self, id: BlockId) -> Option<&BasicBlock> {
        self.index.get(&id).map(|&i| &self.blocks[i])
    }

    /// Mutable lookup of a block by id.
    pub fn block_mut(&mut self, id: BlockId) -> Option<&mut BasicBlock> {
        self.index.get(&id).map(|&i| &mut self.blocks[i])
    }

    /// The number of blocks.
    pub fn len(&self) -> usize {
        self.blocks.len()
    }

    /// Whether the CFG has no blocks.
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// Delete the block with id `id`, preserving the relative order of the
    /// remaining blocks and rebuilding the lookup index. The Rust analog of
    /// `fn.body.blocks.delete(block.id)` on the TS `Map`. A no-op if absent.
    pub fn delete_block(&mut self, id: BlockId) {
        if let Some(&index) = self.index.get(&id) {
            self.blocks.remove(index);
            self.rebuild_index();
        }
    }

    /// Replace all blocks with `blocks` (already in the desired iteration
    /// order), rebuilding the lookup index. Used by passes that reorder/prune
    /// the CFG (e.g. reverse-postorder).
    ///
    /// # Panics
    /// Panics if `blocks` contains a duplicate id.
    pub fn set_blocks(&mut self, blocks: Vec<BasicBlock>) {
        self.blocks = blocks;
        self.index.clear();
        for (i, block) in self.blocks.iter().enumerate() {
            assert!(
                self.index.insert(block.id, i).is_none(),
                "duplicate block id {:?}",
                block.id
            );
        }
    }

    fn rebuild_index(&mut self) {
        self.index.clear();
        for (i, block) in self.blocks.iter().enumerate() {
            self.index.insert(block.id, i);
        }
    }
}

/// A function lowered to HIR form (`HIRFunction` in `HIR.ts`).
///
/// `env` is not stored: stage-1 lowering threads the `Environment` separately,
/// and printing does not need it (matching what `PrintHIR` actually reads).
/// `return_type_annotation` is stubbed as text.
#[derive(Clone, Debug, PartialEq)]
pub struct HirFunction {
    /// Originating source location.
    pub loc: SourceLocation,
    /// The function name, if any (a `ValidIdentifierName`).
    pub id: Option<String>,
    /// A name hint for anonymous functions.
    pub name_hint: Option<String>,
    /// Whether this is a component, hook, or other.
    pub fn_type: ReactFunctionType,
    /// The parameters.
    pub params: Vec<FunctionParam>,
    /// The declared return type annotation (stubbed as text).
    pub return_type_annotation: Option<String>,
    /// The place holding the function's return value.
    pub returns: Place,
    /// Captured context places (from outer scopes).
    pub context: Vec<Place>,
    /// The lowered body CFG.
    pub body: Hir,
    /// Whether this is a generator function.
    pub generator: bool,
    /// Whether this is an async function.
    pub async_: bool,
    /// Source directives (e.g. `"use strict"`).
    pub directives: Vec<String>,
    /// Function-level aliasing effects (stubbed; `None` after lowering).
    pub aliasing_effects: Option<Vec<AliasingEffect>>,
    /// Functions outlined out of this (top-level) function by
    /// `enableFunctionOutlining` (`OutlineFunctions`), the Rust analog of the
    /// `Environment.#outlinedFunctions` list. `printFunctionWithOutlined` appends
    /// each as a `function <id>:` block after the main function body. Only ever
    /// populated on the top-level function (outlining accumulates onto the shared
    /// env in the TS); empty otherwise.
    pub outlined: Vec<HirFunction>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::ids::{IdentifierId, TypeId};
    use crate::hir::place::{Effect, Identifier};

    fn place(id: u32) -> Place {
        Place {
            identifier: Identifier::make_temporary(
                IdentifierId::new(id),
                TypeId::new(0),
                SourceLocation::Generated,
            ),
            effect: Effect::Unknown,
            reactive: false,
            loc: SourceLocation::Generated,
        }
    }

    /// `PhiOperands` preserves first-insertion (predecessor) order, *not* numeric
    /// order — the load-bearing invariant for matching `printPhi`'s JS-`Map`
    /// iteration (e.g. a phi printed as `phi(bb3: ..., bb1: ...)`).
    #[test]
    fn phi_operands_preserve_insertion_order() {
        let mut operands = PhiOperands::new();
        operands.insert(BlockId::new(3), place(5));
        operands.insert(BlockId::new(1), place(6));
        let order: Vec<u32> = operands.keys().map(|b| b.as_u32()).collect();
        assert_eq!(order, vec![3, 1], "non-numeric predecessor order is kept");
    }

    /// Re-inserting an existing key overwrites in place (like `Map.set`); a
    /// `remove` then `insert` appends the key at the end (like `Map.delete`+`set`).
    #[test]
    fn phi_operands_insert_remove_semantics() {
        let mut operands = PhiOperands::new();
        operands.insert(BlockId::new(0), place(1));
        operands.insert(BlockId::new(2), place(2));
        // Overwrite bb0's operand, keeping its leading position.
        operands.insert(BlockId::new(0), place(9));
        assert_eq!(operands.get(&BlockId::new(0)).unwrap().identifier.id.as_u32(), 9);
        assert_eq!(operands.keys().map(|b| b.as_u32()).collect::<Vec<_>>(), vec![0, 2]);
        // Remap (remove + reinsert) appends at the end.
        let op = operands.remove(&BlockId::new(0)).unwrap();
        operands.insert(BlockId::new(5), op);
        assert_eq!(operands.keys().map(|b| b.as_u32()).collect::<Vec<_>>(), vec![2, 5]);
    }
}
