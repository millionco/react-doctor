//! `DisjointSet<T>` — port of `Utils/DisjointSet.ts`.
//!
//! A union-find structure with path compression, matching the TS `union`/`find`
//! semantics exactly (including the "first item becomes root unless it already
//! has one" rule, which determines canonical-id choice). Used by
//! [`find_disjoint_mutable_values`](super::find_disjoint_mutable_values) to group
//! mutably-aliased identifiers and by [`infer_reactive_places`](super::infer_reactive_places)
//! and [`infer_reactive_scope_variables`](super::infer_reactive_scope_variables).
//!
//! The TS keys its map on the element (an `Identifier` object by reference); we
//! instantiate it over [`IdentifierId`](crate::hir::ids::IdentifierId), which is
//! equivalent post-SSA (one object == one unique id).
//!
//! The backing store preserves **insertion order** to mirror the JS `Map`
//! `#entries`. `DisjointSet.forEach` iterates `#entries.keys()` in insertion
//! order, and `inferReactiveScopeVariables` allocates each new scope's `ScopeId`
//! the first time it encounters that scope's representative during that
//! iteration — so the entry insertion order is load-bearing for the `_@N`
//! scope-id assignment to match the oracle.

use std::collections::HashMap;
use std::hash::Hash;

/// An insertion-ordered map from `T` to `T`, the Rust analog of a JavaScript
/// `Map<T, T>`. Iteration (via [`OrderedMap::keys`]) yields keys in
/// first-insertion order; re-inserting an existing key overwrites the value in
/// place and keeps its position (matching `Map.set`).
#[derive(Clone, Debug, Default)]
struct OrderedMap<T: Copy + Eq + Hash> {
    entries: Vec<(T, T)>,
    index: HashMap<T, usize>,
}

impl<T: Copy + Eq + Hash> OrderedMap<T> {
    fn new() -> Self {
        OrderedMap {
            entries: Vec::new(),
            index: HashMap::new(),
        }
    }

    fn contains_key(&self, key: &T) -> bool {
        self.index.contains_key(key)
    }

    fn get(&self, key: &T) -> Option<T> {
        self.index.get(key).map(|&i| self.entries[i].1)
    }

    /// Insert or overwrite, preserving first-insertion order (`Map.set`).
    fn insert(&mut self, key: T, value: T) {
        if let Some(&i) = self.index.get(&key) {
            self.entries[i].1 = value;
        } else {
            self.index.insert(key, self.entries.len());
            self.entries.push((key, value));
        }
    }

    /// The keys in first-insertion order (`Map.keys()`).
    fn keys(&self) -> impl Iterator<Item = T> + '_ {
        self.entries.iter().map(|(k, _)| *k)
    }

    fn len(&self) -> usize {
        self.entries.len()
    }
}

/// A union-find over `T`, mirroring `Utils/DisjointSet.ts`.
#[derive(Clone, Debug, Default)]
pub struct DisjointSet<T: Copy + Eq + Hash> {
    entries: OrderedMap<T>,
}

impl<T: Copy + Eq + Hash> DisjointSet<T> {
    /// An empty disjoint set.
    pub fn new() -> Self {
        DisjointSet {
            entries: OrderedMap::new(),
        }
    }

    /// `union(items)`: link `items` into one set. The first item's existing root
    /// (if any) becomes the set root; otherwise the first item is the new root.
    ///
    /// # Panics
    /// Panics if `items` is empty (matching the TS invariant).
    pub fn union(&mut self, items: &[T]) {
        let (first, rest) = items.split_first().expect("Expected set to be non-empty");
        let first = *first;
        // Determine the root: the first item's existing root, else `first` itself.
        let root = match self.find(first) {
            Some(root) => root,
            None => {
                self.entries.insert(first, first);
                first
            }
        };
        for &item in rest {
            match self.entries.get(&item) {
                None => {
                    // New item, no existing set to update.
                    self.entries.insert(item, root);
                }
                Some(parent) if parent == root => {}
                Some(mut item_parent) => {
                    // Re-root the chain `item -> ... -> old root` onto `root`.
                    let mut current = item;
                    while item_parent != root {
                        self.entries.insert(current, root);
                        current = item_parent;
                        item_parent = self.entries.get(&current).expect("chain element present");
                    }
                }
            }
        }
    }

    /// `find(item)`: the set root for `item`, or `None` if absent. Performs path
    /// compression on the way up.
    pub fn find(&mut self, item: T) -> Option<T> {
        if !self.entries.contains_key(&item) {
            return None;
        }
        let parent = self.entries.get(&item).expect("present");
        if parent == item {
            return Some(item);
        }
        let root = self.find(parent).expect("parent present");
        self.entries.insert(item, root);
        Some(root)
    }

    /// `forEach(fn)`: call `f(item, group)` for each item in the set, in the
    /// **insertion order** of `#entries` (the order items were first added by
    /// `union`). `group` is the item's set representative (root).
    ///
    /// Because `find` mutates (path compression) and would conflict with an
    /// immutable iterator over `self`, this collects the keys first, then
    /// resolves each root. The key order is the JS `Map` insertion order.
    pub fn for_each(&mut self, mut f: impl FnMut(T, T)) {
        let keys: Vec<T> = self.entries.keys().collect();
        for item in keys {
            let group = self.find(item).expect("present");
            f(item, group);
        }
    }

    /// The number of items in the set.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the set is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.len() == 0
    }
}
