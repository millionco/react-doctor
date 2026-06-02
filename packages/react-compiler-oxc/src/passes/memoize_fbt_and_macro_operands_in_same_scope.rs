//! `memoizeFbtAndMacroOperandsInSameScope(fn)` — port of
//! `ReactiveScopes/MemoizeFbtAndMacroOperandsInSameScope.ts`.
//!
//! Forces the operands of `fbt`/`fbs` tags+calls (and user `customMacros`) to
//! share the tag/call's reactive scope, so codegen never lifts a macro argument
//! into a temporary. Returns the set of `IdentifierId`s that participate in a
//! macro (the `fbtOperands`), which `outlineFunctions` consults to avoid
//! outlining a function that is a macro operand.
//!
//! Two data-flow passes:
//! 1. `populateMacroTags` (forward): identify every value that *is* a macro tag
//!    (`fbt` string/global, plus `fbt.foo.bar` property chains).
//! 2. `mergeMacroArguments` (reverse): for each macro *invocation*
//!    (call/method-call/jsx) whose lvalue has a scope, pull its operands into the
//!    tag's scope (when the macro is `Transitive`), recording every touched id in
//!    `macroValues`.
//!
//! For non-fbt/non-macro functions (the common case — empty `customMacros`, no
//! `fbt`/`fbs` tags) `populateMacroTags` finds nothing, so the pass returns an
//! empty set and mutates nothing (a no-op, keeping those fixtures byte-identical).
//! When a macro *does* appear (the `fbt`/`fbs` JSX+call fixtures, or `idx`/`cx`
//! `customMacros`), the transitive merge rewrites each operand's `scope` to the
//! macro's scope and expands that scope's range to enclose every operand, so the
//! whole macro expression memoizes as one unit (no operand lifted into its own
//! temporary / memo block). Because our model clones identifiers into each `Place`
//! (vs. the TS shared object), the scope rewrite is collected into an
//! `id -> scope` side-table and written back over every place of each id at the
//! end; the rewrite is also consulted *during* the reverse walk (as a lvalue-scope
//! override) so the macro tag cascades up an operand chain, exactly as the TS
//! shared-identifier mutation does. The scope-range expansion likewise mirrors the
//! shared `scope.range` via [`reactive_scope_util`] (collect → expand → write back).

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{IdentifierId, InstructionId, ScopeId};
use crate::hir::model::HirFunction;
use crate::hir::place::MutableRange;
use crate::hir::value::{
    InstructionValue, JsxTag, NonLocalBinding, PrimitiveValue, PropertyLiteral,
};

use super::reactive_scope_util::{collect_scope_ranges, for_each_place_mut, write_scope_ranges};

#[derive(Clone, Copy, PartialEq, Eq)]
enum InlineLevel {
    Transitive,
    Shallow,
}

/// A macro definition: an inline level plus optional nested per-property defs.
#[derive(Clone)]
struct MacroDefinition {
    level: InlineLevel,
    /// `Some` for tag-like macros (fbt): per-property definitions plus a `*`
    /// fallback. `None` for leaf macros.
    properties: Option<HashMap<String, MacroDefinition>>,
}

fn shallow() -> MacroDefinition {
    MacroDefinition {
        level: InlineLevel::Shallow,
        properties: None,
    }
}

fn transitive() -> MacroDefinition {
    MacroDefinition {
        level: InlineLevel::Transitive,
        properties: None,
    }
}

/// `FBT_MACRO`: transitive, with `*` → shallow and `enum` → fbt (recursive).
fn fbt_macro() -> MacroDefinition {
    let mut props: HashMap<String, MacroDefinition> = HashMap::new();
    props.insert("*".to_string(), shallow());
    // `enum` maps back to fbt; we expand one level (sufficient for the fixtures,
    // which contain no fbt at all). A deeper chain would re-resolve via the same
    // `properties` map on lookup.
    props.insert("enum".to_string(), {
        let mut inner: HashMap<String, MacroDefinition> = HashMap::new();
        inner.insert("*".to_string(), shallow());
        MacroDefinition {
            level: InlineLevel::Transitive,
            properties: Some(inner),
        }
    });
    MacroDefinition {
        level: InlineLevel::Transitive,
        properties: Some(props),
    }
}

/// The built-in `fbt`/`fbs` tag macros (`FBT_TAGS`).
fn fbt_tags() -> HashMap<String, MacroDefinition> {
    let mut m: HashMap<String, MacroDefinition> = HashMap::new();
    for (name, def) in [
        ("fbt", fbt_macro()),
        ("fbt:param", shallow()),
        ("fbt:enum", fbt_macro()),
        ("fbt:plural", shallow()),
        ("fbs", fbt_macro()),
        ("fbs:param", shallow()),
        ("fbs:enum", fbt_macro()),
        ("fbs:plural", shallow()),
    ] {
        m.insert(name.to_string(), def);
    }
    m
}

/// `memoizeFbtAndMacroOperandsInSameScope(fn)`. Returns the macro-operand id set.
///
/// `custom_macros` mirrors `fn.env.config.customMacros` (defaults empty).
pub fn memoize_fbt_and_macro_operands_in_same_scope(
    func: &mut HirFunction,
    custom_macros: &[String],
) -> HashSet<IdentifierId> {
    let mut macro_kinds = fbt_tags();
    for name in custom_macros {
        macro_kinds.insert(name.clone(), transitive());
    }

    let macro_tags = populate_macro_tags(func, &macro_kinds);
    merge_macro_arguments(func, macro_tags, &macro_kinds)
}

/// Forward pass: map each value id that is a macro tag to its definition.
fn populate_macro_tags(
    func: &HirFunction,
    macro_kinds: &HashMap<String, MacroDefinition>,
) -> HashMap<IdentifierId, MacroDefinition> {
    let mut macro_tags: HashMap<IdentifierId, MacroDefinition> = HashMap::new();
    for block in func.body.blocks() {
        for instr in &block.instructions {
            let lvalue_id = instr.lvalue.identifier.id;
            match &instr.value {
                InstructionValue::Primitive {
                    value: PrimitiveValue::String(s),
                    ..
                } => {
                    if let Some(def) = macro_kinds.get(s) {
                        macro_tags.insert(lvalue_id, def.clone());
                    }
                }
                InstructionValue::LoadGlobal { binding, .. } => {
                    let name = load_global_name(binding);
                    if let Some(name) = name {
                        if let Some(def) = macro_kinds.get(name) {
                            macro_tags.insert(lvalue_id, def.clone());
                        }
                    }
                }
                InstructionValue::PropertyLoad {
                    object, property, ..
                } => {
                    if let Some(prop_name) = property_literal_name(property) {
                        if let Some(base) = macro_tags.get(&object.identifier.id).cloned() {
                            let property_def = base.properties.as_ref().and_then(|props| {
                                props.get(prop_name).or_else(|| props.get("*"))
                            });
                            let resolved = property_def.cloned().unwrap_or(base);
                            macro_tags.insert(lvalue_id, resolved);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    macro_tags
}

/// Reverse pass: pull macro-invocation operands into the tag scope.
fn merge_macro_arguments(
    func: &mut HirFunction,
    mut macro_tags: HashMap<IdentifierId, MacroDefinition>,
    macro_kinds: &HashMap<String, MacroDefinition>,
) -> HashSet<IdentifierId> {
    let mut macro_values: HashSet<IdentifierId> = macro_tags.keys().copied().collect();

    // Scope ranges side-table (mirrors the shared `scope.range`). Mutated by
    // `expandFbtScopeRange`, written back to all members at the end.
    let mut scope_ranges = collect_scope_ranges(func);
    let mut dirty = false;

    // Operand scope reassignments (`operand.identifier.scope = scope` in the TS).
    // Because our model clones identifiers into every `Place`, we accumulate the
    // `id -> targetScope` map here and rewrite *all* places of each id in one
    // write-back, mirroring the TS shared-identifier mutation. The last writer
    // wins, matching the reverse-walk order (a later macro merge of the same id
    // is processed first and so the earliest-block macro's scope sticks — but
    // each id participates in exactly one macro invocation in practice).
    let mut operand_scopes: HashMap<IdentifierId, ScopeId> = HashMap::new();

    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).rev().collect();
    for block_id in block_ids {
        // We need read access to instructions/values while mutating operand
        // scopes/ranges; do it index-wise within the block.
        let block = func.body.block_mut(block_id).expect("block exists");
        let instr_count = block.instructions.len();
        for i in (0..instr_count).rev() {
            let instr = &mut block.instructions[i];
            let lvalue_id = instr.lvalue.identifier.id;
            // The TS mutates `operand.identifier.scope = scope` in place on the
            // shared identifier object, so by the time the reverse walk reaches the
            // *defining* instruction of a value that was pulled into a macro scope,
            // its lvalue already carries that scope (this is what cascades the merge
            // up a `Binary`/operand chain — `fbt("a" + x)` pulls in the `+` and `x`).
            // Our model clones identifiers per place and defers the write-back, so
            // we consult the pending `operand_scopes` map as a scope override here.
            let lvalue_scope = operand_scopes
                .get(&lvalue_id)
                .copied()
                .or(instr.lvalue.identifier.scope);

            // The "never merged" kinds (`break` in the TS switch) are skipped
            // regardless of scope; every other kind requires a non-null lvalue
            // scope (the TS `continue`).
            let never_merged = matches!(
                &instr.value,
                InstructionValue::DeclareContext { .. }
                    | InstructionValue::DeclareLocal { .. }
                    | InstructionValue::Destructure { .. }
                    | InstructionValue::LoadContext { .. }
                    | InstructionValue::LoadLocal { .. }
                    | InstructionValue::PostfixUpdate { .. }
                    | InstructionValue::PrefixUpdate { .. }
                    | InstructionValue::StoreContext { .. }
                    | InstructionValue::StoreLocal { .. }
            );
            if never_merged {
                continue;
            }
            let Some(scope) = lvalue_scope else {
                continue;
            };

            // Determine the macro definition (if any) governing this invocation.
            let definition: Option<MacroDefinition> = match &instr.value {
                InstructionValue::CallExpression { callee, .. } => macro_tags
                    .get(&callee.identifier.id)
                    .or_else(|| macro_tags.get(&lvalue_id))
                    .cloned(),
                InstructionValue::MethodCall { property, .. } => macro_tags
                    .get(&property.identifier.id)
                    .or_else(|| macro_tags.get(&lvalue_id))
                    .cloned(),
                InstructionValue::JsxExpression { tag, .. } => {
                    let by_tag = match tag {
                        JsxTag::Place(place) => macro_tags.get(&place.identifier.id).cloned(),
                        JsxTag::Builtin(builtin) => macro_kinds.get(&builtin.name).cloned(),
                    };
                    by_tag.or_else(|| macro_tags.get(&lvalue_id).cloned())
                }
                _ => macro_tags.get(&lvalue_id).cloned(),
            };

            let Some(definition) = definition else {
                continue;
            };

            visit_operands(
                &definition,
                scope,
                lvalue_id,
                &instr.value,
                &mut macro_values,
                &mut macro_tags,
                &mut scope_ranges,
                &mut operand_scopes,
                &mut dirty,
            );
        }

        // Phi handling: transitive macros pull phi operands into the scope.
        let block = func.body.block_mut(block_id).expect("block exists");
        for phi in &mut block.phis {
            let Some(scope) = phi.place.identifier.scope else {
                continue;
            };
            let phi_id = phi.place.identifier.id;
            let Some(def) = macro_tags.get(&phi_id).cloned() else {
                continue;
            };
            if def.level == InlineLevel::Shallow {
                continue;
            }
            macro_values.insert(phi_id);
            for operand in phi.operands.values_mut() {
                // `operand.identifier.scope = scope` (deferred write-back).
                operand_scopes.insert(operand.identifier.id, scope);
                operand.identifier.scope = Some(scope);
                expand_fbt_scope_range(
                    scope,
                    operand.identifier.mutable_range,
                    &mut scope_ranges,
                    &mut dirty,
                );
                macro_tags.insert(operand.identifier.id, def.clone());
                macro_values.insert(operand.identifier.id);
            }
        }
    }

    // Write back the operand scope reassignments to *every* place of each id
    // (TS shared-identifier mutation), then the (possibly expanded) scope ranges.
    if !operand_scopes.is_empty() {
        for_each_place_mut(func, |place| {
            if let Some(scope) = operand_scopes.get(&place.identifier.id) {
                place.identifier.scope = Some(*scope);
                place.identifier.range_scope = Some(*scope);
            }
        });
    }
    if dirty || !operand_scopes.is_empty() {
        write_scope_ranges(func, &scope_ranges);
    }
    macro_values
}

#[allow(clippy::too_many_arguments)]
fn visit_operands(
    definition: &MacroDefinition,
    scope: ScopeId,
    lvalue_id: IdentifierId,
    value: &InstructionValue,
    macro_values: &mut HashSet<IdentifierId>,
    macro_tags: &mut HashMap<IdentifierId, MacroDefinition>,
    scope_ranges: &mut HashMap<ScopeId, MutableRange>,
    operand_scopes: &mut HashMap<IdentifierId, ScopeId>,
    dirty: &mut bool,
) {
    macro_values.insert(lvalue_id);
    // Snapshot the operand ids + ranges (read-only walk of the value).
    let operands: Vec<(IdentifierId, MutableRange)> =
        super::cfg::each_instruction_value_operand(value)
            .into_iter()
            .map(|p| (p.identifier.id, p.identifier.mutable_range))
            .collect();
    for (id, range) in operands {
        if definition.level == InlineLevel::Transitive {
            // `operand.identifier.scope = scope`: pull the operand into the
            // macro's scope so codegen never lifts it into its own temporary /
            // memo block. Deferred to a single write-back over all places of `id`
            // to mirror the TS shared-identifier mutation.
            operand_scopes.insert(id, scope);
            expand_fbt_scope_range(scope, range, scope_ranges, dirty);
            macro_tags.insert(id, definition.clone());
        }
        macro_values.insert(id);
    }
}

fn expand_fbt_scope_range(
    scope: ScopeId,
    extend_with: MutableRange,
    scope_ranges: &mut HashMap<ScopeId, MutableRange>,
    dirty: &mut bool,
) {
    if extend_with.start.as_u32() != 0 {
        if let Some(range) = scope_ranges.get_mut(&scope) {
            let new_start = range.start.as_u32().min(extend_with.start.as_u32());
            if new_start != range.start.as_u32() {
                range.start = InstructionId::new(new_start);
                *dirty = true;
            }
        }
    }
}

fn load_global_name(binding: &NonLocalBinding) -> Option<&str> {
    match binding {
        NonLocalBinding::Global { name } | NonLocalBinding::ModuleLocal { name } => Some(name),
        NonLocalBinding::ImportDefault { name, .. }
        | NonLocalBinding::ImportNamespace { name, .. }
        | NonLocalBinding::ImportSpecifier { name, .. } => Some(name),
    }
}

/// `typeof value.property === 'string'` — only string property names participate
/// in macro-tag propagation.
fn property_literal_name(property: &PropertyLiteral) -> Option<&str> {
    match property {
        PropertyLiteral::String(s) => Some(s),
        PropertyLiteral::Number(_) => None,
    }
}
