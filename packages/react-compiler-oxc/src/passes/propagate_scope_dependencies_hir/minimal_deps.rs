// Included from `propagate_scope_dependencies_hir.rs`.
//
// Port of `HIR/DeriveMinimalDependenciesHIR.ts::ReactiveScopeDependencyTreeHIR`.
// Joins each raw dependency with the CFG-inferred hoistable-object tree to
// truncate it to its maximal safe-to-evaluate subpath, then derives the minimal
// (non-subpath) dependency set.

#[derive(Clone, Copy, PartialEq, Eq)]
enum PropertyAccessType {
    OptionalAccess,
    UnconditionalAccess,
    OptionalDependency,
    UnconditionalDependency,
}

impl PropertyAccessType {
    fn is_optional(self) -> bool {
        matches!(
            self,
            PropertyAccessType::OptionalAccess | PropertyAccessType::OptionalDependency
        )
    }
    fn is_dependency(self) -> bool {
        matches!(
            self,
            PropertyAccessType::OptionalDependency | PropertyAccessType::UnconditionalDependency
        )
    }
}

fn merge_access(a: PropertyAccessType, b: PropertyAccessType) -> PropertyAccessType {
    let result_unconditional = !(a.is_optional() && b.is_optional());
    let result_dependency = a.is_dependency() || b.is_dependency();
    match (result_unconditional, result_dependency) {
        (true, true) => PropertyAccessType::UnconditionalDependency,
        (true, false) => PropertyAccessType::UnconditionalAccess,
        (false, true) => PropertyAccessType::OptionalDependency,
        (false, false) => PropertyAccessType::OptionalAccess,
    }
}

/// Hoistable-tree node access type (`'Optional' | 'NonNull'`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum HoistableAccess {
    Optional,
    NonNull,
}

#[derive(Clone)]
struct HoistableTreeNode {
    access_type: HoistableAccess,
    properties: HashMap<PropKey, usize>,
}

#[derive(Clone)]
struct DepTreeNode {
    access_type: PropertyAccessType,
    loc: SourceLocation,
    /// Insertion-ordered children: (key, property-literal, node index).
    properties: Vec<(PropKey, PropertyLiteral, usize)>,
    property_index: HashMap<PropKey, usize>,
}

struct ReactiveScopeDependencyTreeHir {
    hoistable_nodes: Vec<HoistableTreeNode>,
    hoistable_roots: HashMap<IdentifierId, (usize, bool)>,
    dep_nodes: Vec<DepTreeNode>,
    /// Root order preserved (insertion order of first `addDependency`).
    dep_roots: Vec<(IdentifierId, usize, bool, Identifier)>,
    dep_root_index: HashMap<IdentifierId, usize>,
}

impl ReactiveScopeDependencyTreeHir {
    fn new(hoistable_objects: impl Iterator<Item = ReactiveScopeDependency>) -> Self {
        let mut tree = ReactiveScopeDependencyTreeHir {
            hoistable_nodes: Vec::new(),
            hoistable_roots: HashMap::new(),
            dep_nodes: Vec::new(),
            dep_roots: Vec::new(),
            dep_root_index: HashMap::new(),
        };
        for dep in hoistable_objects {
            let default_access = if !dep.path.is_empty() && dep.path[0].optional {
                HoistableAccess::Optional
            } else {
                HoistableAccess::NonNull
            };
            let mut curr = tree.hoistable_get_or_create_root(&dep.identifier, default_access);
            for i in 0..dep.path.len() {
                let access = if i + 1 < dep.path.len() && dep.path[i + 1].optional {
                    HoistableAccess::Optional
                } else {
                    HoistableAccess::NonNull
                };
                let key = prop_key(&dep.path[i].property);
                let existing = tree.hoistable_nodes[curr].properties.get(&key).copied();
                let next = match existing {
                    Some(idx) => idx,
                    None => {
                        let idx = tree.hoistable_nodes.len();
                        tree.hoistable_nodes.push(HoistableTreeNode {
                            access_type: access,
                            properties: HashMap::new(),
                        });
                        tree.hoistable_nodes[curr].properties.insert(key, idx);
                        idx
                    }
                };
                curr = next;
            }
        }
        tree
    }

    fn hoistable_get_or_create_root(
        &mut self,
        identifier: &Identifier,
        default_access: HoistableAccess,
    ) -> usize {
        if let Some(&(idx, _)) = self.hoistable_roots.get(&identifier.id) {
            return idx;
        }
        let idx = self.hoistable_nodes.len();
        self.hoistable_nodes.push(HoistableTreeNode {
            access_type: default_access,
            properties: HashMap::new(),
        });
        self.hoistable_roots.insert(identifier.id, (idx, true));
        idx
    }

    fn dep_get_or_create_root(
        &mut self,
        identifier: &Identifier,
        reactive: bool,
        default_access: PropertyAccessType,
        loc: SourceLocation,
    ) -> usize {
        if let Some(&pos) = self.dep_root_index.get(&identifier.id) {
            return self.dep_roots[pos].1;
        }
        let idx = self.dep_nodes.len();
        self.dep_nodes.push(DepTreeNode {
            access_type: default_access,
            loc,
            properties: Vec::new(),
            property_index: HashMap::new(),
        });
        let pos = self.dep_roots.len();
        self.dep_roots
            .push((identifier.id, idx, reactive, identifier.clone()));
        self.dep_root_index.insert(identifier.id, pos);
        idx
    }

    fn make_or_merge_property(
        &mut self,
        node: usize,
        property: &PropertyLiteral,
        access_type: PropertyAccessType,
        loc: SourceLocation,
    ) -> usize {
        let key = prop_key(property);
        if let Some(&child) = self.dep_nodes[node].property_index.get(&key) {
            let merged = merge_access(self.dep_nodes[child].access_type, access_type);
            self.dep_nodes[child].access_type = merged;
            return child;
        }
        let child = self.dep_nodes.len();
        self.dep_nodes.push(DepTreeNode {
            access_type,
            loc,
            properties: Vec::new(),
            property_index: HashMap::new(),
        });
        self.dep_nodes[node]
            .property_index
            .insert(key.clone(), child);
        self.dep_nodes[node]
            .properties
            .push((key, property.clone(), child));
        child
    }

    fn add_dependency(&mut self, dep: ReactiveScopeDependency) {
        let ReactiveScopeDependency {
            identifier,
            reactive,
            path,
            loc,
        } = dep;
        let mut dep_cursor = self.dep_get_or_create_root(
            &identifier,
            reactive,
            PropertyAccessType::UnconditionalAccess,
            loc,
        );
        let mut hoistable_cursor = self.hoistable_roots.get(&identifier.id).map(|&(idx, _)| idx);

        for entry in &path {
            let next_hoistable;
            let next_dep;
            if entry.optional {
                next_hoistable = hoistable_cursor.and_then(|h| {
                    self.hoistable_nodes[h]
                        .properties
                        .get(&prop_key(&entry.property))
                        .copied()
                });
                let access = if hoistable_cursor.is_some_and(|h| {
                    self.hoistable_nodes[h].access_type == HoistableAccess::NonNull
                }) {
                    PropertyAccessType::UnconditionalAccess
                } else {
                    PropertyAccessType::OptionalAccess
                };
                next_dep =
                    self.make_or_merge_property(dep_cursor, &entry.property, access, entry.loc.clone());
            } else if hoistable_cursor.is_some_and(|h| {
                self.hoistable_nodes[h].access_type == HoistableAccess::NonNull
            }) {
                next_hoistable = hoistable_cursor.and_then(|h| {
                    self.hoistable_nodes[h]
                        .properties
                        .get(&prop_key(&entry.property))
                        .copied()
                });
                next_dep = self.make_or_merge_property(
                    dep_cursor,
                    &entry.property,
                    PropertyAccessType::UnconditionalAccess,
                    entry.loc.clone(),
                );
            } else {
                break;
            }
            dep_cursor = next_dep;
            hoistable_cursor = next_hoistable;
        }
        let merged = merge_access(
            self.dep_nodes[dep_cursor].access_type,
            PropertyAccessType::OptionalDependency,
        );
        self.dep_nodes[dep_cursor].access_type = merged;
    }

    fn derive_minimal_dependencies(&self) -> Vec<ReactiveScopeDependency> {
        let mut results: Vec<ReactiveScopeDependency> = Vec::new();
        for &(_, root_idx, reactive, ref root_ident) in &self.dep_roots {
            self.collect_minimal_in_subtree(root_idx, reactive, root_ident, Vec::new(), &mut results);
        }
        results
    }

    fn collect_minimal_in_subtree(
        &self,
        node: usize,
        reactive: bool,
        root_identifier: &Identifier,
        path: Vec<DependencyPathEntry>,
        results: &mut Vec<ReactiveScopeDependency>,
    ) {
        let node_ref = &self.dep_nodes[node];
        if node_ref.access_type.is_dependency() {
            results.push(ReactiveScopeDependency {
                identifier: root_identifier.clone(),
                reactive,
                path,
                loc: node_ref.loc.clone(),
            });
        } else {
            for (_, property, child) in &node_ref.properties {
                let child_node = &self.dep_nodes[*child];
                let mut child_path = path.clone();
                child_path.push(DependencyPathEntry {
                    property: property.clone(),
                    optional: child_node.access_type.is_optional(),
                    loc: child_node.loc.clone(),
                });
                self.collect_minimal_in_subtree(
                    *child,
                    reactive,
                    root_identifier,
                    child_path,
                    results,
                );
            }
        }
    }
}
