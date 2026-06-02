//! `outlineJSX(fn)` — port of `Optimization/OutlineJsx.ts`.
//!
//! Gated on `enableJsxOutlining` (TS default `false`, set by `@enableJsxOutlining`).
//! Hoists a run of nested JSX elements out of a callback (a non-`Component`
//! function — only callbacks are outlined for now) into a freshly-generated
//! top-level component, replacing the inline JSX with a single
//! `<T0 .../>`-style element that loads the generated component and forwards the
//! collected attributes/children as props.
//!
//! The outlined component is appended to the *top-level* function's
//! [`HirFunction::outlined`] list (the Rust analog of
//! `Environment.#outlinedFunctions`), so `codegenOutlined` emits it after the
//! original function. The JSX instructions retain the reactive scopes assigned
//! by `inferReactiveScopeVariables` (which runs before this pass), so the
//! outlined component memoizes its sub-elements exactly like the oracle's `_temp`.
//!
//! Mirrors `OutlineJsx.ts` instruction-for-instruction: a backwards scan over
//! each block groups consecutive nested-JSX runs (`state.jsx` / `state.children`),
//! `process` collects the props, emits the replacement `<tag .../>`, and builds
//! the outlined function (destructure props -> load globals -> the rewritten JSX
//! -> return).

use std::collections::{HashMap, HashSet};

use crate::hir::ids::{BlockId, DeclarationId, IdentifierId, InstructionId, TypeId};
use crate::hir::instruction::Instruction;
use crate::hir::model::{
    BasicBlock, BlockKind, BlockSet, FunctionParam, Hir, HirFunction, ReactFunctionType,
};
use crate::hir::place::{Effect, Identifier, IdentifierName, Place, SourceLocation};
use crate::hir::terminal::{ReturnVariant, Terminal};
use crate::hir::value::{
    InstructionKind, InstructionValue, JsxAttribute, JsxTag, LValuePattern, NonLocalBinding,
    ObjectPattern, ObjectPatternProperty, ObjectProperty, ObjectPropertyKey, Pattern, PropertyType,
};
use crate::passes::PassContext;
use crate::passes::dead_code_elimination::dead_code_elimination;

/// `outlineJSX(fn)`: outline nested JSX runs out of callbacks within `func`,
/// accumulating the outlined components onto `func.outlined`.
pub fn outline_jsx(func: &mut HirFunction, ctx: &mut PassContext) {
    let mut allocator = UidAllocator::new();
    let mut outlined: Vec<HirFunction> = Vec::new();
    outline_jsx_impl(func, ctx, &mut allocator, &mut outlined);
    // `for (const outlinedFn of outlinedFns) fn.env.outlineFunction(outlinedFn, 'Component')`.
    // The outlined components accumulate after any already-present outlined
    // functions; `OutlineFunctions` runs after this pass and appends to the
    // same list.
    func.outlined.extend(outlined);
}

/// Babel-`generateUid`-style globally-unique names: `_<base>`, `_<base>2`, …
/// (the default base is `temp`). Identical to `OutlineFunctions`'s allocator —
/// JSX outlining shares the same naming scheme.
struct UidAllocator {
    used: HashSet<String>,
}

impl UidAllocator {
    fn new() -> Self {
        UidAllocator {
            used: HashSet::new(),
        }
    }

    /// `generateGloballyUniqueIdentifierName(name)` → a fresh `_<name>`/`_<name>N`.
    fn generate(&mut self, name: Option<&str>) -> String {
        let base = name.unwrap_or("temp");
        let mut candidate = format!("_{base}");
        let mut counter = 2u32;
        while self.used.contains(&candidate) {
            candidate = format!("_{base}{counter}");
            counter += 1;
        }
        self.used.insert(candidate.clone());
        candidate
    }
}

/// A JSX run accumulated during the backwards block scan (`State` in the TS).
struct State {
    jsx: Vec<Instruction>,
    children: HashSet<IdentifierId>,
}

impl State {
    fn new() -> Self {
        State {
            jsx: Vec::new(),
            children: HashSet::new(),
        }
    }
}

/// `outlineJsxImpl(fn, outlinedFns)`: recurse into nested functions, then scan
/// each block backwards grouping nested-JSX runs and outlining each run.
fn outline_jsx_impl(
    func: &mut HirFunction,
    ctx: &mut PassContext,
    allocator: &mut UidAllocator,
    outlined: &mut Vec<HirFunction>,
) {
    // `globals`: LoadGlobal instructions keyed by their lvalue id, so the
    // outlined function can re-emit the component-tag globals it references.
    let mut globals: HashMap<IdentifierId, Instruction> = HashMap::new();

    let block_ids: Vec<BlockId> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        // `rewriteInstr`: 1-indexed instruction id -> replacement instructions.
        let mut rewrite_instr: HashMap<u32, Vec<Instruction>> = HashMap::new();
        let mut state = State::new();

        // Snapshot the block's instructions for the backwards scan (we recurse
        // into nested functions, which needs `&mut`, so collect indices first).
        let instr_count = func
            .body
            .block(block_id)
            .map(|b| b.instructions.len())
            .unwrap_or(0);

        for i in (0..instr_count).rev() {
            // Recurse into nested functions first (needs &mut on the lowered
            // func). We then re-read the (immutable) instruction for the
            // grouping logic.
            {
                let block = func.body.block_mut(block_id).expect("block exists");
                let instr = &mut block.instructions[i];
                if let InstructionValue::FunctionExpression { lowered_func, .. } = &mut instr.value {
                    outline_jsx_impl(&mut lowered_func.func, ctx, allocator, outlined);
                }
            }

            let block = func.body.block(block_id).expect("block exists");
            let instr = &block.instructions[i];
            let lvalue_id = instr.lvalue.identifier.id;
            match &instr.value {
                InstructionValue::LoadGlobal { .. } => {
                    globals.insert(lvalue_id, instr.clone());
                }
                InstructionValue::FunctionExpression { .. } => {
                    // Already recursed above.
                }
                InstructionValue::JsxExpression { .. } => {
                    if !state.children.contains(&lvalue_id) {
                        process_and_outline(
                            func, block_id, &mut state, &mut rewrite_instr, &globals, ctx,
                            allocator, outlined,
                        );
                        state = State::new();
                    }
                    let instr = func.body.block(block_id).expect("block exists").instructions[i]
                        .clone();
                    if let InstructionValue::JsxExpression {
                        children: Some(children),
                        ..
                    } = &instr.value
                    {
                        for child in children {
                            state.children.insert(child.identifier.id);
                        }
                    }
                    state.jsx.push(instr);
                }
                // Every other instruction value is opaque to JSX outlining.
                _ => {}
            }
        }
        process_and_outline(
            func, block_id, &mut state, &mut rewrite_instr, &globals, ctx, allocator, outlined,
        );

        if !rewrite_instr.is_empty() {
            let block = func.body.block_mut(block_id).expect("block exists");
            let old = std::mem::take(&mut block.instructions);
            let mut new_instrs = Vec::with_capacity(old.len());
            for (i, instr) in old.into_iter().enumerate() {
                // InstructionId's are one-indexed, so add one to account for them.
                let id = (i + 1) as u32;
                if let Some(replacement) = rewrite_instr.remove(&id) {
                    new_instrs.extend(replacement);
                } else {
                    new_instrs.push(instr);
                }
            }
            block.instructions = new_instrs;
        }
        dead_code_elimination(func);
    }
}

/// `processAndOutlineJSX(state, rewriteInstr)`: outline the accumulated run if it
/// holds more than one JSX element.
#[allow(clippy::too_many_arguments)]
fn process_and_outline(
    func: &mut HirFunction,
    block_id: BlockId,
    state: &mut State,
    rewrite_instr: &mut HashMap<u32, Vec<Instruction>>,
    globals: &HashMap<IdentifierId, Instruction>,
    ctx: &mut PassContext,
    allocator: &mut UidAllocator,
    outlined: &mut Vec<HirFunction>,
) {
    if state.jsx.len() <= 1 {
        return;
    }
    // `[...state.jsx].sort((a, b) => a.id - b.id)`.
    let mut jsx: Vec<Instruction> = std::mem::take(&mut state.jsx);
    jsx.sort_by_key(|i| i.id.as_u32());
    // The whole JSX run collapses to the single outlined `<T0 .../>` call. The
    // emitted replacement reuses the outermost element's lvalue (`jsx.at(-1)`),
    // so it must sit at that element's position — *after* any non-JSX
    // instructions (e.g. the `LoadLocal`s the inner elements' props read) that
    // are interspersed within the run and survive (they feed the replacement's
    // forwarded props). All the run's JSX instructions are removed; non-JSX
    // instructions between them stay (and are DCE'd if they become unused). This
    // matches the oracle's post-pass HIR, where only the replacement survives at
    // the outermost JSX's slot.
    let run_ids: Vec<u32> = jsx.iter().map(|i| i.id.as_u32()).collect();
    let last_id = *run_ids.last().expect("non-empty");
    if let Some(result) = process(func, jsx, globals, ctx, allocator) {
        // Promote the surviving definitions of the children that `collectProps`
        // promoted (e.g. a `JSXText "Test"` whose value would otherwise be
        // inlined), so the callback codegen declares them as named `const tN`.
        if !result.promoted_children.is_empty() {
            promote_live_definitions(func, block_id, &result.promoted_children);
        }
        outlined.push(result.func);
        rewrite_instr.insert(last_id, result.instrs);
        for id in run_ids {
            if id != last_id {
                rewrite_instr.entry(id).or_default();
            }
        }
    }
}

/// Promote (name `#t<decl>`) the lvalue of any instruction in `block_id` whose
/// declaration id is in `decls` — the live counterpart of the `promoteTemporary`
/// `collectProps` applied to the forwarded child place.
fn promote_live_definitions(
    func: &mut HirFunction,
    block_id: BlockId,
    decls: &[DeclarationId],
) {
    let Some(block) = func.body.block_mut(block_id) else {
        return;
    };
    for instr in &mut block.instructions {
        if instr.lvalue.identifier.name.is_none()
            && decls.contains(&instr.lvalue.identifier.declaration_id)
        {
            instr.lvalue.identifier.promote_temporary();
        }
    }
}

struct OutlinedResult {
    instrs: Vec<Instruction>,
    func: HirFunction,
    /// Declaration ids of non-JSX children promoted by `collectProps`; the caller
    /// promotes the matching surviving instructions in the live block.
    promoted_children: Vec<DeclarationId>,
}

/// `process(fn, jsx, globals)`.
fn process(
    func: &HirFunction,
    jsx: Vec<Instruction>,
    globals: &HashMap<IdentifierId, Instruction>,
    ctx: &mut PassContext,
    allocator: &mut UidAllocator,
) -> Option<OutlinedResult> {
    // Only outline jsx in callbacks (a top-level component bails). A backedge
    // check for loops is a TODO in the TS.
    if func.fn_type == ReactFunctionType::Component {
        return None;
    }

    let props = collect_props(&jsx)?;
    let outlined_tag = allocator.generate(None);
    let new_instrs = emit_outlined_jsx(&jsx, &props.attributes, &outlined_tag, ctx);
    let mut outlined_fn = emit_outlined_fn(&jsx, &props.attributes, globals, ctx)?;
    outlined_fn.id = Some(outlined_tag);

    Some(OutlinedResult {
        instrs: new_instrs,
        func: outlined_fn,
        promoted_children: props.promoted_children,
    })
}

/// One collected JSX attribute / child to forward as a prop.
struct OutlinedJsxAttribute {
    original_name: String,
    new_name: String,
    place: Place,
}

/// The result of `collectProps`: the forwarded attributes plus the declaration
/// ids of non-JSX children that were promoted (`promoteTemporary`) — the caller
/// promotes the matching live instructions so the callback declares them rather
/// than inlining the value.
struct CollectedProps {
    attributes: Vec<OutlinedJsxAttribute>,
    promoted_children: Vec<DeclarationId>,
}

/// `collectProps(env, instructions)`: gather every attribute (renaming on
/// collision) plus every non-inner-JSX child (promoted to a temporary). Returns
/// `None` if any element has a spread attribute.
fn collect_props(jsx: &[Instruction]) -> Option<CollectedProps> {
    let mut id = 1u32;
    let mut seen: HashSet<String> = HashSet::new();

    // `generateName(oldName)`: a fresh name, suffixing `id++` on collision.
    let mut generate_name = |old_name: &str, seen: &mut HashSet<String>| -> String {
        let mut new_name = old_name.to_string();
        while seen.contains(&new_name) {
            new_name = format!("{old_name}{id}");
            id += 1;
        }
        seen.insert(new_name.clone());
        new_name
    };

    let mut attributes: Vec<OutlinedJsxAttribute> = Vec::new();
    let mut promoted_children: Vec<DeclarationId> = Vec::new();
    let jsx_ids: HashSet<IdentifierId> =
        jsx.iter().map(|i| i.lvalue.identifier.id).collect();

    for instr in jsx {
        let InstructionValue::JsxExpression { props, children, .. } = &instr.value else {
            continue;
        };
        for at in props {
            match at {
                JsxAttribute::Spread { .. } => return None,
                JsxAttribute::Attribute { name, place } => {
                    let new_name = generate_name(name, &mut seen);
                    attributes.push(OutlinedJsxAttribute {
                        original_name: name.clone(),
                        new_name,
                        place: place.clone(),
                    });
                }
            }
        }
        if let Some(children) = children {
            for child in children {
                if jsx_ids.contains(&child.identifier.id) {
                    continue;
                }
                // `promoteTemporary(child.identifier)` — name the child a
                // `#t<decl>` temporary (so the callback codegen declares it as
                // `const tN = …` rather than inlining the value) and forward it as
                // a prop named after that promoted name. Only unnamed temporaries
                // are promotable; a child that is already a named local is
                // forwarded under its existing name.
                let mut place = child.clone();
                if place.identifier.name.is_none() {
                    place.identifier.promote_temporary();
                    promoted_children.push(child.identifier.declaration_id);
                }
                let original_name = match &place.identifier.name {
                    Some(IdentifierName::Promoted { value })
                    | Some(IdentifierName::Named { value }) => value.clone(),
                    None => format!("#t{}", place.identifier.declaration_id.as_u32()),
                };
                let new_name = generate_name("t", &mut seen);
                attributes.push(OutlinedJsxAttribute {
                    original_name,
                    new_name,
                    place,
                });
            }
        }
    }
    Some(CollectedProps {
        attributes,
        promoted_children,
    })
}

/// `emitOutlinedJsx(env, instructions, outlinedProps, outlinedTag)`: the two
/// replacement instructions — a `LoadGlobal` of the outlined tag and a
/// `JsxExpression` that forwards the collected props.
fn emit_outlined_jsx(
    jsx: &[Instruction],
    outlined_props: &[OutlinedJsxAttribute],
    outlined_tag: &str,
    ctx: &mut PassContext,
) -> Vec<Instruction> {
    let props: Vec<JsxAttribute> = outlined_props
        .iter()
        .map(|p| JsxAttribute::Attribute {
            name: p.new_name.clone(),
            place: p.place.clone(),
        })
        .collect();

    let mut load_jsx_lvalue = create_temporary_place(ctx);
    load_jsx_lvalue.identifier.promote_temporary_jsx_tag();
    let load_jsx = Instruction {
        id: InstructionId::new(0),
        loc: SourceLocation::Generated,
        lvalue: load_jsx_lvalue.clone(),
        value: InstructionValue::LoadGlobal {
            binding: NonLocalBinding::ModuleLocal {
                name: outlined_tag.to_string(),
            },
            loc: SourceLocation::Generated,
        },
        effects: None,
    };

    let jsx_expr = Instruction {
        id: InstructionId::new(0),
        loc: SourceLocation::Generated,
        lvalue: jsx.last().expect("non-empty").lvalue.clone(),
        value: InstructionValue::JsxExpression {
            tag: JsxTag::Place(load_jsx_lvalue),
            props,
            children: None,
            loc: SourceLocation::Generated,
            opening_loc: SourceLocation::Generated,
            closing_loc: SourceLocation::Generated,
        },
        effects: None,
    };

    vec![load_jsx, jsx_expr]
}

/// `emitOutlinedFn(env, jsx, oldProps, globals)`: build the outlined component —
/// destructure the props param, re-load the JSX-tag globals, then the rewritten
/// JSX, returning the last value.
fn emit_outlined_fn(
    jsx: &[Instruction],
    old_props: &[OutlinedJsxAttribute],
    globals: &HashMap<IdentifierId, Instruction>,
    ctx: &mut PassContext,
) -> Option<HirFunction> {
    let mut instructions: Vec<Instruction> = Vec::new();
    let old_to_new = create_old_to_new_props_mapping(old_props, ctx);

    let mut props_obj = create_temporary_place(ctx);
    props_obj.identifier.promote_temporary();

    let destructure_props = emit_destructure_props(&props_obj, &old_to_new, ctx);
    instructions.push(destructure_props);

    let updated_jsx = emit_updated_jsx(jsx, &old_to_new);
    let load_globals = emit_load_globals(jsx, globals)?;
    instructions.extend(load_globals);
    instructions.extend(updated_jsx);

    let returns_place = instructions.last().expect("non-empty").lvalue.clone();
    let block_id = BlockId::new(0);
    let block = BasicBlock {
        kind: BlockKind::Block,
        id: block_id,
        instructions,
        terminal: Terminal::Return {
            return_variant: ReturnVariant::Explicit,
            value: returns_place,
            id: InstructionId::new(0),
            effects: None,
            loc: SourceLocation::Generated,
        },
        preds: BlockSet::new(),
        phis: Vec::new(),
    };

    let mut body = Hir::new(block_id);
    body.push_block(block);

    Some(HirFunction {
        loc: SourceLocation::Generated,
        id: None,
        name_hint: None,
        // The TS builds the outlined HIR fn with `fnType: 'Other'`, but
        // `outlineFunction(outlinedFn, 'Component')` registers it with type
        // `Component`: at the Program layer the inserted outlined source is
        // re-queued and *re-compiled as a Component*, which is what materializes
        // its internal reactive scopes (`_c(N)` memoization). We carry that
        // intent on `fn_type` so `codegenOutlined` knows to re-compile this fn
        // (vs. `OutlineFunctions`, which registers `null` → emitted flat).
        fn_type: ReactFunctionType::Component,
        params: vec![FunctionParam::Place(props_obj)],
        return_type_annotation: None,
        returns: create_temporary_place(ctx),
        context: Vec::new(),
        body,
        generator: false,
        async_: false,
        directives: Vec::new(),
        aliasing_effects: Some(Vec::new()),
        outlined: Vec::new(),
    })
}

/// `emitLoadGlobals(jsx, globals)`: re-emit the LoadGlobal instruction for each
/// JSX tag that is an identifier (a component). Returns `None` if a tag's global
/// was not collected.
fn emit_load_globals(
    jsx: &[Instruction],
    globals: &HashMap<IdentifierId, Instruction>,
) -> Option<Vec<Instruction>> {
    let mut instructions = Vec::new();
    for instr in jsx {
        let InstructionValue::JsxExpression { tag, .. } = &instr.value else {
            continue;
        };
        if let JsxTag::Place(place) = tag {
            let load_global = globals.get(&place.identifier.id)?;
            instructions.push(load_global.clone());
        }
    }
    Some(instructions)
}

/// `emitUpdatedJsx(jsx, oldToNewProps)`: rewrite each JSX element to reference the
/// destructured props (dropping `key`) and the inner-JSX / prop children.
fn emit_updated_jsx(
    jsx: &[Instruction],
    old_to_new: &HashMap<IdentifierId, OutlinedJsxAttribute>,
) -> Vec<Instruction> {
    let jsx_ids: HashSet<IdentifierId> =
        jsx.iter().map(|i| i.lvalue.identifier.id).collect();

    let mut new_instrs = Vec::with_capacity(jsx.len());
    for instr in jsx {
        let InstructionValue::JsxExpression {
            tag,
            props,
            children,
            loc,
            opening_loc,
            closing_loc,
        } = &instr.value
        else {
            continue;
        };

        let mut new_props: Vec<JsxAttribute> = Vec::new();
        for prop in props {
            let JsxAttribute::Attribute { name, place } = prop else {
                // `invariant(prop.kind === 'JsxAttribute', ...)`: spreads were
                // rejected in collectProps, so this is unreachable.
                continue;
            };
            if name == "key" {
                continue;
            }
            let new_prop = old_to_new
                .get(&place.identifier.id)
                .expect("expected a new property for the attribute place");
            new_props.push(JsxAttribute::Attribute {
                name: new_prop.original_name.clone(),
                place: new_prop.place.clone(),
            });
        }

        let new_children = children.as_ref().map(|children| {
            let mut new_children = Vec::with_capacity(children.len());
            for child in children {
                if jsx_ids.contains(&child.identifier.id) {
                    new_children.push(child.clone());
                    continue;
                }
                let new_child = old_to_new
                    .get(&child.identifier.id)
                    .expect("expected a new prop for the child place");
                new_children.push(new_child.place.clone());
            }
            new_children
        });

        let mut new_instr = instr.clone();
        new_instr.value = InstructionValue::JsxExpression {
            tag: tag.clone(),
            props: new_props,
            children: new_children,
            loc: loc.clone(),
            opening_loc: opening_loc.clone(),
            closing_loc: closing_loc.clone(),
        };
        new_instrs.push(new_instr);
    }
    new_instrs
}

/// `createOldToNewPropsMapping(env, oldProps)`: for each non-`key` prop, a fresh
/// destructure-target place named after the generated prop name, keyed by the
/// original place's identifier id.
fn create_old_to_new_props_mapping(
    old_props: &[OutlinedJsxAttribute],
    ctx: &mut PassContext,
) -> HashMap<IdentifierId, OutlinedJsxAttribute> {
    let mut out = HashMap::new();
    for old_prop in old_props {
        if old_prop.original_name == "key" {
            continue;
        }
        let mut place = create_temporary_place(ctx);
        place.identifier.name = Some(IdentifierName::Named {
            value: old_prop.new_name.clone(),
        });
        out.insert(
            old_prop.place.identifier.id,
            OutlinedJsxAttribute {
                original_name: old_prop.original_name.clone(),
                new_name: old_prop.new_name.clone(),
                place,
            },
        );
    }
    out
}

/// `emitDestructureProps(env, propsObj, oldToNewProps)`: `const { <newName>: <place>, … } = propsObj`.
fn emit_destructure_props(
    props_obj: &Place,
    old_to_new: &HashMap<IdentifierId, OutlinedJsxAttribute>,
    ctx: &mut PassContext,
) -> Instruction {
    // Preserve insertion order of the source `oldProps` so the destructure
    // pattern matches the oracle's ordering. `create_old_to_new_props_mapping`
    // built a HashMap; rebuild the ordered property list from it by sorting on
    // the original prop sequence is unnecessary — the TS iterates the Map in
    // insertion order. We reconstruct insertion order via the new place ids,
    // which are allocated in source order.
    let mut props_ordered: Vec<&OutlinedJsxAttribute> = old_to_new.values().collect();
    props_ordered.sort_by_key(|p| p.place.identifier.id.as_u32());

    let mut properties: Vec<ObjectPatternProperty> = Vec::new();
    for prop in props_ordered {
        properties.push(ObjectPatternProperty::Property(ObjectProperty {
            key: ObjectPropertyKey::String {
                name: prop.new_name.clone(),
            },
            property_type: PropertyType::Property,
            place: prop.place.clone(),
        }));
    }

    Instruction {
        id: InstructionId::new(0),
        lvalue: create_temporary_place(ctx),
        loc: SourceLocation::Generated,
        value: InstructionValue::Destructure {
            lvalue: LValuePattern {
                pattern: Pattern::Object(ObjectPattern {
                    properties,
                    loc: SourceLocation::Generated,
                }),
                kind: InstructionKind::Let,
            },
            value: props_obj.clone(),
            loc: SourceLocation::Generated,
        },
        effects: None,
    }
}

/// `createTemporaryPlace(env, loc)`: a fresh unnamed temporary place.
fn create_temporary_place(ctx: &mut PassContext) -> Place {
    let id = ctx.next_identifier_id();
    Place {
        identifier: Identifier::make_temporary(id, TypeId::new(0), SourceLocation::Generated),
        effect: Effect::Unknown,
        reactive: false,
        loc: SourceLocation::Generated,
    }
}
