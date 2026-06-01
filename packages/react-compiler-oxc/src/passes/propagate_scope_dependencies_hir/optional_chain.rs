// Included from `propagate_scope_dependencies_hir.rs`.
//
// Port of `HIR/CollectOptionalChainDependencies.ts::collectOptionalChainSidemap`.
// Walks `optional` terminals (and the nested optionals they reference) to build:
//   - `temporaries_read_in_optional`: id -> the `a?.b` dependency for the
//     consequent/property temporaries of a hoistable optional chain
//   - `processed_instrs_in_optional`: StoreLocal/test instructions to skip during
//     dependency collection (their dep is taken at site-of-use)
//   - `hoistable_objects`: optional-block id -> the base it's safe to load from

use crate::hir::terminal::GotoVariant;

struct OptionalTraversalContext {
    seen_optionals: HashSet<BlockId>,
    processed: ProcessedSet,
    temporaries_read_in_optional: HashMap<IdentifierId, ReactiveScopeDependency>,
    hoistable_objects: HashMap<BlockId, ReactiveScopeDependency>,
}

fn collect_optional_chain_sidemap(func: &HirFunction) -> OptionalChainSidemap {
    let mut context = OptionalTraversalContext {
        seen_optionals: HashSet::new(),
        processed: HashSet::new(),
        temporaries_read_in_optional: HashMap::new(),
        hoistable_objects: HashMap::new(),
    };
    traverse_optional_function(func, &mut context);
    OptionalChainSidemap {
        temporaries_read_in_optional: context.temporaries_read_in_optional,
        processed_instrs_in_optional: context.processed,
        hoistable_objects: context.hoistable_objects,
    }
}

/// `traverseFunction`: recurse into nested functions, then process each
/// (unseen) `optional` block of `func`. Block ids are unique across the whole
/// program here (the lowering env never resets the counter), and the optional
/// chains of an optional terminal are resolved against the *same* function's
/// blocks, so the per-function block table is always the active `func`.
fn traverse_optional_function(func: &HirFunction, context: &mut OptionalTraversalContext) {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    traverse_optional_function(&lowered_func.func, context);
                }
                _ => {}
            }
        }
        if let Terminal::Optional { .. } = &block.terminal {
            if !context.seen_optionals.contains(&block.id) {
                traverse_optional_block(func, block.id, context, None);
            }
        }
    }
}

fn block_of(func: &HirFunction, id: BlockId) -> Option<&crate::hir::model::BasicBlock> {
    func.body.block(id)
}

struct MatchConsequent {
    consequent_id: IdentifierId,
    property: PropertyLiteral,
    property_id: IdentifierId,
    /// The matched `StoreLocal` instruction's lvalue [`IdentifierId`]. Used to key
    /// the processed-in-optional set: unlike [`InstructionId`], IdentifierIds are
    /// allocated globally (never reset per nested function), so keying by it avoids
    /// the cross-function instruction-id collision the TS sidesteps by keying its
    /// `#processedInstrsInOptional` set on the instruction *object* identity.
    store_local_lvalue_id: IdentifierId,
    consequent_goto: BlockId,
    property_load_loc: SourceLocation,
}

/// `matchOptionalTestBlock`: match the consequent/alternate of an optional `test`
/// branch as a simple `PropertyLoad` + `StoreLocal`.
fn match_optional_test_block(
    func: &HirFunction,
    test_consequent: BlockId,
    test_alternate: BlockId,
    test_id: IdentifierId,
) -> Option<MatchConsequent> {
    let consequent = block_of(func, test_consequent)?;
    if consequent.instructions.len() == 2 {
        let i0 = &consequent.instructions[0];
        let i1 = &consequent.instructions[1];
        if let (
            InstructionValue::PropertyLoad {
                object,
                property,
                loc: prop_loc,
            },
            InstructionValue::StoreLocal {
                lvalue: store_lvalue,
                value: store_value,
                ..
            },
        ) = (&i0.value, &i1.value)
        {
            // Invariants: PropertyLoad base == test, StoreLocal value == PropertyLoad lvalue.
            debug_assert_eq!(object.identifier.id, test_id);
            debug_assert_eq!(store_value.identifier.id, i0.lvalue.identifier.id);

            match &consequent.terminal {
                Terminal::Goto {
                    variant: GotoVariant::Break,
                    block: goto_block,
                    ..
                } => {
                    // alternate must be Primitive + StoreLocal (asserted in TS).
                    let _alternate = block_of(func, test_alternate)?;
                    return Some(MatchConsequent {
                        consequent_id: store_lvalue.place.identifier.id,
                        property: property.clone(),
                        property_id: i0.lvalue.identifier.id,
                        store_local_lvalue_id: i1.lvalue.identifier.id,
                        consequent_goto: *goto_block,
                        property_load_loc: prop_loc.clone(),
                    });
                }
                _ => return None,
            }
        }
    }
    None
}

/// `traverseOptionalBlock`: returns the IdentifierId representing the optional
/// chain if it precisely represents a chain of property loads, else `None`.
fn traverse_optional_block(
    func: &HirFunction,
    optional_id: BlockId,
    context: &mut OptionalTraversalContext,
    outer_alternate: Option<BlockId>,
) -> Option<IdentifierId> {
    context.seen_optionals.insert(optional_id);

    let optional_block = block_of(func, optional_id)?;
    let (opt_optional, opt_test, opt_fallthrough) = match &optional_block.terminal {
        Terminal::Optional {
            optional,
            test,
            fallthrough,
            ..
        } => (*optional, *test, *fallthrough),
        _ => return None,
    };
    let optional_instr_count = optional_block.instructions.len();

    let maybe_test = block_of(func, opt_test)?;

    let base_object: ReactiveScopeDependency;
    let test_alternate: BlockId;
    let test_consequent: BlockId;
    let test_id: IdentifierId;

    match &maybe_test.terminal {
        Terminal::Branch {
            test,
            consequent,
            alternate,
            ..
        } => {
            // Base case must be optional.
            if !opt_optional {
                return None;
            }
            if maybe_test.instructions.is_empty() {
                return None;
            }
            let first = &maybe_test.instructions[0];
            let (base_place, base_reactive, base_loc) = match &first.value {
                InstructionValue::LoadLocal { place, .. } => {
                    (place.identifier.clone(), place.reactive, place.loc.clone())
                }
                _ => return None,
            };
            let mut path: Vec<DependencyPathEntry> = Vec::new();
            for i in 1..maybe_test.instructions.len() {
                let instr_val = &maybe_test.instructions[i].value;
                let prev = &maybe_test.instructions[i - 1];
                if let InstructionValue::PropertyLoad {
                    object,
                    property,
                    loc,
                } = instr_val
                {
                    if object.identifier.id == prev.lvalue.identifier.id {
                        path.push(DependencyPathEntry {
                            property: property.clone(),
                            optional: false,
                            loc: loc.clone(),
                        });
                        continue;
                    }
                }
                return None;
            }
            base_object = ReactiveScopeDependency {
                identifier: base_place,
                reactive: base_reactive,
                path,
                loc: base_loc,
            };
            test_alternate = *alternate;
            test_consequent = *consequent;
            test_id = test.identifier.id;
        }
        Terminal::Optional {
            fallthrough: inner_fallthrough,
            ..
        } => {
            let test_block = block_of(func, *inner_fallthrough)?;
            let (tb_test, tb_consequent, tb_alternate) = match &test_block.terminal {
                Terminal::Branch {
                    test,
                    consequent,
                    alternate,
                    ..
                } => (test.identifier.id, *consequent, *alternate),
                _ => return None,
            };
            let inner_optional =
                traverse_optional_block(func, opt_test, context, Some(tb_alternate))?;
            if tb_test != inner_optional {
                return None;
            }
            if !opt_optional {
                let base = context
                    .temporaries_read_in_optional
                    .get(&inner_optional)?
                    .clone();
                context.hoistable_objects.insert(optional_id, base);
            }
            base_object = context
                .temporaries_read_in_optional
                .get(&inner_optional)?
                .clone();
            test_alternate = tb_alternate;
            test_consequent = tb_consequent;
            test_id = tb_test;
        }
        _ => return None,
    }

    if Some(test_alternate) == outer_alternate {
        // Inner optional block must have no instructions (asserted in TS).
        if optional_instr_count != 0 {
            return None;
        }
    }

    let match_result =
        match_optional_test_block(func, test_consequent, test_alternate, test_id)?;

    if match_result.consequent_goto != opt_fallthrough {
        return None;
    }

    let mut load_path = base_object.path.clone();
    load_path.push(DependencyPathEntry {
        property: match_result.property.clone(),
        optional: opt_optional,
        loc: match_result.property_load_loc.clone(),
    });
    let load = ReactiveScopeDependency {
        identifier: base_object.identifier.clone(),
        reactive: base_object.reactive,
        path: load_path,
        loc: match_result.property_load_loc.clone(),
    };

    context
        .processed
        .insert(ProcessedKey::Instruction(match_result.store_local_lvalue_id));
    // `test` is the Branch terminal of the test block; record by its terminal id.
    if let Some(test_block) = block_of(func, opt_test) {
        // For the branch base-case, the test block IS maybe_test (opt_test).
        // For the nested-optional case, the relevant test terminal is in the inner
        // optional's fallthrough block; but the TS records `test` (the branch
        // terminal it matched). Re-resolve it here.
        let branch_id = resolve_branch_terminal_id(func, &test_block.terminal, opt_test);
        if let Some(id) = branch_id {
            context.processed.insert(ProcessedKey::Terminal(id));
        }
    }

    context
        .temporaries_read_in_optional
        .insert(match_result.consequent_id, load.clone());
    context
        .temporaries_read_in_optional
        .insert(match_result.property_id, load);
    Some(match_result.consequent_id)
}

/// Resolve the globally-unique key of the `Branch` terminal that gates
/// `test_consequent`, as the branch's `test`-operand [`IdentifierId`] (terminal
/// ids are per-function and collide across nested functions; see [`ProcessedKey`]).
/// For the base case the test block's own terminal is the branch; for the nested
/// case the branch lives in the inner optional's fallthrough block.
fn resolve_branch_terminal_id(
    func: &HirFunction,
    test_terminal: &Terminal,
    _opt_test: BlockId,
) -> Option<IdentifierId> {
    match test_terminal {
        Terminal::Branch { test, .. } => Some(test.identifier.id),
        Terminal::Optional {
            fallthrough,
            ..
        } => {
            let test_block = block_of(func, *fallthrough)?;
            if let Terminal::Branch { test, .. } = &test_block.terminal {
                Some(test.identifier.id)
            } else {
                None
            }
        }
        _ => None,
    }
}
