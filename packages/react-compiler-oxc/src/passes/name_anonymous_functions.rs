//! `nameAnonymousFunctions(fn)` — port of `Transform/NameAnonymousFunctions.ts`.
//!
//! Gated on `enableNameAnonymousFunctions` (TS default `false`, set by the
//! `@enableNameAnonymousFunctions` pragma). Runs in the pipeline after
//! `OutlineJSX` and before `OutlineFunctions`.
//!
//! Synthesizes a `nameHint` for each *anonymous* function expression from its
//! surrounding context — the variable it is assigned to (`Component[foo]`), the
//! call it is passed to (`Component[identity()]`), the hook argument it forms
//! (`Component[useEffect()]`), or the JSX attribute it is bound to
//! (`Component[<div>.onClick]`) — building hierarchical names with `[`/`> `
//! separators down the nesting tree. Already-named functions keep their name but
//! still propagate a prefix to their inner anonymous functions. Codegen
//! (`codegenInstructionValue` `FunctionExpression` case) consults the same
//! `enableNameAnonymousFunctions` flag and, for an anonymous function with a
//! `nameHint`, wraps the expression in `{ "<hint>": <fn> }["<hint>"]` so the JS
//! engine infers the descriptive `.name`.
//!
//! The TS holds live references to the `FunctionExpression` IR nodes inside the
//! `Node` tree and mutates `node.fn.nameHint` in the `visit` phase. We cannot
//! borrow into the HIR while we analyse it, so the analysis records each
//! function expression by a *path* (a chain of `(block_index, instruction_index)`
//! coordinates from the enclosing function). `visit` then computes the final name
//! for each path, and a final mutating walk writes the `name_hint` on both the
//! `FunctionExpression` value and its `loweredFunc.func`.

use std::collections::HashMap;

use crate::hir::model::HirFunction;
use crate::hir::value::{CallArgument, InstructionValue, JsxAttribute, JsxTag, NonLocalBinding};
use crate::passes::infer_reactive_places::{HookKind, get_hook_kind};

/// `nameAnonymousFunctions(fn)`: assign `name_hint`s to the anonymous function
/// expressions within `fn`, from the bottom up.
pub fn name_anonymous_functions(func: &mut HirFunction) {
    // `if (fn.id == null) return;` — anonymous components get no prefix.
    let Some(parent_name) = func.id.clone() else {
        return;
    };
    let mut nodes = analyze(func);
    // `for (const node of functions) visit(node, `${parentName}[`)`.
    let prefix = format!("{parent_name}[");
    for node in &mut nodes {
        visit(node, &prefix);
    }
    // Apply the computed `name_hint`s back onto the HIR, walking the node tree in
    // lockstep with the function-expression instructions.
    apply(func, &nodes);
}

/// The analysis result for one function expression (the TS `Node`), located by
/// its `(block_index, instruction_index)` coordinate within its *enclosing*
/// function. `generated_name` is the name derived from its surrounding context
/// (or `None` if none could be inferred); `final_name` is the resolved hierarchical
/// `name_hint` computed by `visit`; `inner` holds the nodes for the functions
/// nested directly inside it.
struct Node {
    coord: (usize, usize),
    generated_name: Option<String>,
    /// The static name of the function expression (`value.name`), if any. Mirrors
    /// the TS `node.fn.name` used when computing the next prefix for named fns.
    fn_name: Option<String>,
    final_name: Option<String>,
    inner: Vec<Node>,
}

/// `visit(node, prefix)`: assign the final `name_hint` for `node` (if it is an
/// anonymous function with a `generatedName`) and recurse into its inner
/// functions with the extended prefix.
fn visit(node: &mut Node, prefix: &str) {
    // We only name functions that were originally anonymous and have a generated
    // name. Already-named functions (those with `fn.name`) are skipped here but
    // still propagate a prefix. The TS additionally guards on
    // `node.fn.nameHint == null`, which is always true on first run.
    if let Some(generated) = &node.generated_name {
        if node.fn_name.is_none() {
            node.final_name = Some(format!("{prefix}{generated}]"));
        }
    }
    // `const nextPrefix = `${prefix}${generatedName ?? fn.name ?? '<anonymous>'} > `;`
    let label = node
        .generated_name
        .clone()
        .or_else(|| node.fn_name.clone())
        .unwrap_or_else(|| "<anonymous>".to_string());
    let next_prefix = format!("{prefix}{label} > ");
    for inner in &mut node.inner {
        visit(inner, &next_prefix);
    }
}

/// `apply`: walk the function's nested function expressions in source order,
/// matching each against its analysis [`Node`] by `(block, instruction)`
/// coordinate, and set each named function's `name_hint` (both on the
/// `FunctionExpression` value and the lowered function it wraps).
fn apply(func: &mut HirFunction, nodes: &[Node]) {
    for (bi, block) in func.body.blocks_mut().iter_mut().enumerate() {
        for (ii, instr) in block.instructions.iter_mut().enumerate() {
            if let InstructionValue::FunctionExpression { name_hint, lowered_func, .. } =
                &mut instr.value
            {
                let Some(node) = nodes.iter().find(|n| n.coord == (bi, ii)) else {
                    continue;
                };
                if let Some(hint) = &node.final_name {
                    *name_hint = Some(hint.clone());
                    lowered_func.func.name_hint = Some(hint.clone());
                }
                apply(&mut lowered_func.func, &node.inner);
            }
        }
    }
}

/// `nameAnonymousFunctionsImpl(fn)`: collect the function-expression nodes within
/// `fn`, deriving each one's `generatedName` from how it is used (stored into a
/// variable, passed to a call/method-call, or bound to a JSX attribute), and
/// recursing into each function expression's body.
fn analyze(func: &HirFunction) -> Vec<Node> {
    // Functions we track to generate names for, keyed by the identifier id that
    // currently *holds* the function (its lvalue id, propagated through loads).
    let mut functions: HashMap<u32, usize> = HashMap::new();
    // Temporaries that read from variables/globals/properties, used to build the
    // callee/element name strings.
    let mut local_names: HashMap<u32, String> = HashMap::new();
    // All function nodes, in source order, to bubble up for later renaming.
    let mut nodes: Vec<Node> = Vec::new();

    for (bi, block) in func.body.blocks().iter().enumerate() {
        for (ii, instr) in block.instructions.iter().enumerate() {
            let lvalue_id = instr.lvalue.identifier.id.as_u32();
            match &instr.value {
                InstructionValue::LoadGlobal { binding, .. } => {
                    local_names.insert(lvalue_id, non_local_binding_name(binding).to_string());
                }
                InstructionValue::LoadContext { place, .. }
                | InstructionValue::LoadLocal { place, .. } => {
                    if let Some(name) = named_value(place) {
                        local_names.insert(lvalue_id, name);
                    }
                    let src = place.identifier.id.as_u32();
                    if let Some(&node_idx) = functions.get(&src) {
                        functions.insert(lvalue_id, node_idx);
                    }
                }
                InstructionValue::PropertyLoad { object, property, .. } => {
                    if let Some(object_name) = local_names.get(&object.identifier.id.as_u32()) {
                        local_names
                            .insert(lvalue_id, format!("{object_name}.{}", property_string(property)));
                    }
                }
                InstructionValue::FunctionExpression { name, lowered_func, .. } => {
                    let inner = analyze(&lowered_func.func);
                    let node = Node {
                        coord: (bi, ii),
                        generated_name: None,
                        fn_name: name.clone(),
                        final_name: None,
                        inner,
                    };
                    nodes.push(node);
                    // Bubble up all functions (even named ones, so inner anonymous
                    // functions still get names), but only *generate* names for
                    // the anonymous ones.
                    if name.is_none() {
                        functions.insert(lvalue_id, nodes.len() - 1);
                    }
                }
                InstructionValue::StoreContext { value, place, .. } => {
                    set_generated_name_from_store(&mut nodes, &mut functions, value, place);
                }
                InstructionValue::StoreLocal { value, lvalue, .. } => {
                    set_generated_name_from_store(&mut nodes, &mut functions, value, &lvalue.place);
                }
                InstructionValue::CallExpression { callee, args, .. } => {
                    let callee_name = call_callee_name(callee, &local_names);
                    apply_call_names(&mut nodes, &mut functions, &callee_name, args);
                }
                InstructionValue::MethodCall { property, args, .. } => {
                    let callee_name = call_callee_name(property, &local_names);
                    apply_call_names(&mut nodes, &mut functions, &callee_name, args);
                }
                InstructionValue::JsxExpression { tag, props, .. } => {
                    for attr in props {
                        let JsxAttribute::Attribute { name: attr_name, place } = attr else {
                            continue;
                        };
                        let Some(&node_idx) = functions.get(&place.identifier.id.as_u32()) else {
                            continue;
                        };
                        if nodes[node_idx].generated_name.is_some() {
                            continue;
                        }
                        let element_name = match tag {
                            JsxTag::Builtin(builtin) => Some(builtin.name.clone()),
                            JsxTag::Place(p) => local_names.get(&p.identifier.id.as_u32()).cloned(),
                        };
                        let prop_name = match element_name {
                            None => attr_name.clone(),
                            Some(elem) => format!("<{elem}>.{attr_name}"),
                        };
                        nodes[node_idx].generated_name = Some(prop_name);
                        functions.remove(&place.identifier.id.as_u32());
                    }
                }
                _ => {}
            }
        }
    }
    nodes
}

/// `StoreLocal`/`StoreContext`: when the value being stored is a tracked
/// anonymous function and the lvalue is a named local, record the variable name
/// as the function's generated name.
fn set_generated_name_from_store(
    nodes: &mut [Node],
    functions: &mut HashMap<u32, usize>,
    value: &crate::hir::place::Place,
    lvalue_place: &crate::hir::place::Place,
) {
    let src = value.identifier.id.as_u32();
    let Some(&node_idx) = functions.get(&src) else {
        return;
    };
    if nodes[node_idx].generated_name.is_some() {
        return;
    }
    if let Some(variable_name) = named_value(lvalue_place) {
        nodes[node_idx].generated_name = Some(variable_name);
        functions.remove(&src);
    }
}

/// The callee/property name string for a `CallExpression`/`MethodCall`. The TS
/// uses the hook kind directly when it is a non-`Custom` hook, otherwise the name
/// resolved from `names` (falling back to `(anonymous)`).
fn call_callee_name(
    callee: &crate::hir::place::Place,
    local_names: &HashMap<u32, String>,
) -> String {
    let hook_kind = get_hook_kind(&callee.identifier);
    match hook_kind {
        Some(kind) if kind != HookKind::Custom => hook_kind_name(kind).to_string(),
        _ => local_names
            .get(&callee.identifier.id.as_u32())
            .cloned()
            .unwrap_or_else(|| "(anonymous)".to_string()),
    }
}

/// `CallExpression`/`MethodCall` argument naming: for each tracked anonymous
/// function passed positionally, set its generated name to `<callee>()` (or
/// `<callee>(argN)` when more than one function argument is present).
fn apply_call_names(
    nodes: &mut [Node],
    functions: &mut HashMap<u32, usize>,
    callee_name: &str,
    args: &[CallArgument],
) {
    // `fnArgCount`: number of positional arguments that are tracked functions.
    let mut fn_arg_count = 0usize;
    for arg in args {
        if let CallArgument::Place(p) = arg {
            if functions.contains_key(&p.identifier.id.as_u32()) {
                fn_arg_count += 1;
            }
        }
    }
    for (i, arg) in args.iter().enumerate() {
        let CallArgument::Place(p) = arg else {
            continue;
        };
        let Some(&node_idx) = functions.get(&p.identifier.id.as_u32()) else {
            continue;
        };
        if nodes[node_idx].generated_name.is_some() {
            continue;
        }
        let generated = if fn_arg_count > 1 {
            format!("{callee_name}(arg{i})")
        } else {
            format!("{callee_name}()")
        };
        nodes[node_idx].generated_name = Some(generated);
        functions.remove(&p.identifier.id.as_u32());
    }
}

/// The local name of a place if it carries a `named` identifier name (the TS
/// `name.kind === 'named'` guard), else `None`.
fn named_value(place: &crate::hir::place::Place) -> Option<String> {
    match &place.identifier.name {
        Some(crate::hir::place::IdentifierName::Named { value }) => Some(value.clone()),
        _ => None,
    }
}

/// `String(value.property)` for a `PropertyLoad` property literal — the JS
/// number-to-string form for a numeric index, the value itself for a string.
fn property_string(property: &crate::hir::value::PropertyLiteral) -> String {
    match property {
        crate::hir::value::PropertyLiteral::String(s) => s.clone(),
        crate::hir::value::PropertyLiteral::Number(n) => {
            if n.fract() == 0.0 && n.is_finite() {
                format!("{}", *n as i64)
            } else {
                format!("{n}")
            }
        }
    }
}

/// The local name of any `NonLocalBinding` variant (`binding.name`).
fn non_local_binding_name(binding: &NonLocalBinding) -> &str {
    match binding {
        NonLocalBinding::ImportDefault { name, .. }
        | NonLocalBinding::ImportNamespace { name, .. }
        | NonLocalBinding::ImportSpecifier { name, .. }
        | NonLocalBinding::ModuleLocal { name }
        | NonLocalBinding::Global { name } => name,
    }
}

/// The TS `HookKind` string spelling, for the non-`Custom` hook kinds we
/// distinguish (`useState`/`useRef`/…). Used only when naming a callback passed
/// to such a hook; `Custom` hooks fall back to the resolved global name instead.
fn hook_kind_name(kind: HookKind) -> &'static str {
    match kind {
        HookKind::UseState => "useState",
        HookKind::UseRef => "useRef",
        HookKind::UseReducer => "useReducer",
        HookKind::UseActionState => "useActionState",
        HookKind::UseTransition => "useTransition",
        HookKind::UseOptimistic => "useOptimistic",
        HookKind::Custom => "Custom",
    }
}
