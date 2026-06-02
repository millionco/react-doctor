//! `BuildReactiveFunction`: convert a post-`PropagateScopeDependenciesHIR`
//! [`HirFunction`] (an HIR control-flow graph) into a [`ReactiveFunction`] (a
//! nested, scoped tree), ported from
//! `packages/react-compiler/src/ReactiveScopes/BuildReactiveFunction.ts`.
//!
//! This pass restores the original control-flow constructs (if/while/for/switch/
//! try/…), including labeled break/continue, and the reactive-scope nesting that
//! the `scope`/`pruned-scope` HIR terminals encode. It naively emits labels for
//! *all* terminals; `PruneUnusedLabels` (a later pass) removes the unnecessary
//! ones.

use std::collections::HashSet;

use crate::hir::ids::{BlockId, InstructionId};
use crate::hir::model::{BasicBlock, Hir, HirFunction};
use crate::hir::place::{Place, SourceLocation};
use crate::hir::terminal::{GotoVariant, LogicalOperator, Terminal};
use crate::hir::value::InstructionValue;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveLogicalValue,
    ReactiveOptionalCallValue, ReactiveSequenceValue, ReactiveStatement, ReactiveScopeBlock,
    ReactiveSwitchCase, ReactiveTerminal, ReactiveTerminalStatement, ReactiveTerminalTargetKind,
    ReactiveTernaryValue, ReactiveValue, TerminalLabel,
};

/// Convert `fn`'s HIR body into a [`ReactiveFunction`] (`buildReactiveFunction`).
pub fn build_reactive_function(func: &HirFunction) -> ReactiveFunction {
    let mut cx = Context::new(&func.body);
    let entry_block = cx.block(func.body.entry).clone();
    let body = {
        let mut driver = Driver { cx: &mut cx };
        driver.traverse_block(&entry_block)
    };
    ReactiveFunction {
        loc: func.loc.clone(),
        id: func.id.clone(),
        name_hint: func.name_hint.clone(),
        params: func.params.clone(),
        generator: func.generator,
        async_: func.async_,
        body,
        directives: func.directives.clone(),
    }
}

/// The continuation result threaded through value-block visiting (the TS
/// `{block, value, place, id}` object).
struct ValueResult {
    block: BlockId,
    value: ReactiveValue,
    place: Place,
    id: InstructionId,
}

/// The result of visiting a value-block terminal (`visitValueBlockTerminal`).
struct TerminalResult {
    value: ReactiveValue,
    place: Place,
    fallthrough: BlockId,
    id: InstructionId,
}

struct Driver<'a, 'b> {
    cx: &'b mut Context<'a>,
}

impl Driver<'_, '_> {
    /// `wrapWithSequence`: prepend `instructions` to `continuation`, wrapping the
    /// continuation's value in a `SequenceExpression` when there are any.
    fn wrap_with_sequence(
        instructions: Vec<ReactiveInstruction>,
        continuation: ValueResult,
        loc: SourceLocation,
    ) -> ValueResult {
        if instructions.is_empty() {
            return continuation;
        }
        let sequence = ReactiveSequenceValue {
            instructions,
            id: continuation.id,
            value: continuation.value,
            loc,
        };
        ValueResult {
            block: continuation.block,
            value: ReactiveValue::Sequence(Box::new(sequence)),
            place: continuation.place,
            id: continuation.id,
        }
    }

    /// `extractValueBlockResult`: pull the result value out of the instructions
    /// ending a value block, pruning a temporary-targeted `StoreLocal`.
    fn extract_value_block_result(
        instructions: &[crate::hir::instruction::Instruction],
        block_id: BlockId,
        loc: SourceLocation,
    ) -> ValueResult {
        let instr = instructions
            .last()
            .expect("Expected non-empty instructions in extractValueBlockResult");
        let mut place: Place = instr.lvalue.clone();
        let mut value: ReactiveValue = ReactiveValue::Instruction(Box::new(instr.value.clone()));
        if let InstructionValue::StoreLocal {
            lvalue,
            value: store_value,
            ..
        } = &instr.value
        {
            if lvalue.place.identifier.name.is_none() {
                place = lvalue.place.clone();
                value = ReactiveValue::Instruction(Box::new(InstructionValue::LoadLocal {
                    place: store_value.clone(),
                    loc: store_value.loc.clone(),
                }));
            }
        }
        if instructions.len() == 1 {
            return ValueResult {
                block: block_id,
                place,
                value,
                id: instr.id,
            };
        }
        let sequence = ReactiveSequenceValue {
            instructions: instructions[..instructions.len() - 1]
                .iter()
                .map(reactive_instruction_from_hir)
                .collect(),
            id: instr.id,
            value,
            loc,
        };
        ValueResult {
            block: block_id,
            place,
            value: ReactiveValue::Sequence(Box::new(sequence)),
            id: instr.id,
        }
    }

    /// `valueBlockResultToSequence`: build a `SequenceExpression` carrying the
    /// instruction with its lvalue, flattening nested sequences and dropping a
    /// trailing no-op `LoadLocal` of the same place.
    fn value_block_result_to_sequence(
        result: ValueResult,
        loc: SourceLocation,
    ) -> ReactiveSequenceValue {
        let mut instructions: Vec<ReactiveInstruction> = Vec::new();
        let mut inner_value = result.value;
        // Flatten nested SequenceExpressions.
        while let ReactiveValue::Sequence(seq) = inner_value {
            instructions.extend(seq.instructions);
            inner_value = seq.value;
        }

        let is_load_of_same_place = matches!(
            &inner_value,
            ReactiveValue::Instruction(iv)
                if matches!(
                    iv.as_ref(),
                    InstructionValue::LoadLocal { place, .. }
                        if place.identifier.id == result.place.identifier.id
                )
        );

        if !is_load_of_same_place {
            instructions.push(ReactiveInstruction {
                id: result.id,
                lvalue: Some(result.place),
                value: inner_value,
                effects: None,
                loc: loc.clone(),
            });
        }

        ReactiveSequenceValue {
            instructions,
            id: result.id,
            value: ReactiveValue::Instruction(Box::new(InstructionValue::Primitive {
                value: crate::hir::value::PrimitiveValue::Undefined,
                loc: loc.clone(),
            })),
            loc,
        }
    }

    fn traverse_block(&mut self, block: &BasicBlock) -> ReactiveBlock {
        let mut block_value: ReactiveBlock = Vec::new();
        self.visit_block(block, &mut block_value);
        block_value
    }

    fn visit_block(&mut self, block: &BasicBlock, block_value: &mut ReactiveBlock) {
        assert!(
            self.cx.emitted.insert(block.id),
            "Cannot emit the same block twice: bb{}",
            block.id.as_u32()
        );
        for instruction in &block.instructions {
            block_value.push(ReactiveStatement::Instruction(reactive_instruction_from_hir(
                instruction,
            )));
        }

        let terminal = block.terminal.clone();
        let mut schedule_ids: Vec<usize> = Vec::new();
        match &terminal {
            Terminal::Return {
                value, id, loc, ..
            } => {
                block_value.push(terminal_statement(
                    ReactiveTerminal::Return {
                        value: value.clone(),
                        id: *id,
                        loc: loc.clone(),
                    },
                    None,
                ));
            }
            Terminal::Throw { value, id, loc } => {
                block_value.push(terminal_statement(
                    ReactiveTerminal::Throw {
                        value: value.clone(),
                        id: *id,
                        loc: loc.clone(),
                    },
                    None,
                ));
            }
            Terminal::If {
                test,
                consequent,
                alternate,
                fallthrough,
                id,
                loc,
            } => {
                let fallthrough_id = if self.cx.reachable(*fallthrough)
                    && !self.cx.is_scheduled(*fallthrough)
                {
                    Some(*fallthrough)
                } else {
                    None
                };
                let alternate_id = if alternate != fallthrough {
                    Some(*alternate)
                } else {
                    None
                };

                if let Some(fid) = fallthrough_id {
                    schedule_ids.push(self.cx.schedule(fid));
                }

                let consequent_block = {
                    let b = self.cx.block(*consequent).clone();
                    self.traverse_block(&b)
                };

                let alternate_block = alternate_id.map(|aid| {
                    let b = self.cx.block(aid).clone();
                    self.traverse_block(&b)
                });

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::If {
                        test: test.clone(),
                        consequent: consequent_block,
                        alternate: alternate_block,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Switch {
                test,
                cases,
                fallthrough,
                id,
                loc,
            } => {
                let fallthrough_id = if self.cx.reachable(*fallthrough)
                    && !self.cx.is_scheduled(*fallthrough)
                {
                    Some(*fallthrough)
                } else {
                    None
                };
                if let Some(fid) = fallthrough_id {
                    schedule_ids.push(self.cx.schedule(fid));
                }

                let mut reactive_cases: Vec<ReactiveSwitchCase> = Vec::new();
                // `[...cases].reverse().forEach(...)`, then `cases.reverse()`.
                for case in cases.iter().rev() {
                    if self.cx.is_scheduled(case.block) {
                        assert_eq!(
                            case.block, *fallthrough,
                            "Unexpected 'switch' where a case is already scheduled and block is not the fallthrough"
                        );
                        continue;
                    }
                    let consequent = {
                        let b = self.cx.block(case.block).clone();
                        self.traverse_block(&b)
                    };
                    schedule_ids.push(self.cx.schedule(case.block));
                    reactive_cases.push(ReactiveSwitchCase {
                        test: case.test.clone(),
                        block: Some(consequent),
                    });
                }
                reactive_cases.reverse();

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::Switch {
                        test: test.clone(),
                        cases: reactive_cases,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::DoWhile {
                loop_block,
                test,
                fallthrough,
                id,
                loc,
            } => {
                let fallthrough_id = if !self.cx.is_scheduled(*fallthrough) {
                    Some(*fallthrough)
                } else {
                    None
                };
                let loop_id = if !self.cx.is_scheduled(*loop_block) && loop_block != fallthrough {
                    Some(*loop_block)
                } else {
                    None
                };
                schedule_ids.push(self.cx.schedule_loop(*fallthrough, *test, Some(*loop_block)));

                let loop_body = {
                    let lid = loop_id.expect("Unexpected 'do-while' where the loop is already scheduled");
                    let b = self.cx.block(lid).clone();
                    self.traverse_block(&b)
                };

                let test_value = self.visit_value_block(*test, loc.clone(), None).value;

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::DoWhile {
                        test: test_value,
                        loop_: loop_body,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::While {
                test,
                loop_block,
                fallthrough,
                id,
                loc,
            } => {
                let fallthrough_id = if self.cx.reachable(*fallthrough)
                    && !self.cx.is_scheduled(*fallthrough)
                {
                    Some(*fallthrough)
                } else {
                    None
                };
                let loop_id = if !self.cx.is_scheduled(*loop_block) && loop_block != fallthrough {
                    Some(*loop_block)
                } else {
                    None
                };
                schedule_ids.push(self.cx.schedule_loop(*fallthrough, *test, Some(*loop_block)));

                let test_value = self.visit_value_block(*test, loc.clone(), None).value;

                let loop_body = {
                    let lid = loop_id.expect("Unexpected 'while' where the loop is already scheduled");
                    let b = self.cx.block(lid).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::While {
                        test: test_value,
                        loop_: loop_body,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::For {
                init,
                test,
                update,
                loop_block,
                fallthrough,
                id,
                loc,
            } => {
                let loop_id = if !self.cx.is_scheduled(*loop_block) && loop_block != fallthrough {
                    Some(*loop_block)
                } else {
                    None
                };
                let fallthrough_id = if !self.cx.is_scheduled(*fallthrough) {
                    Some(*fallthrough)
                } else {
                    None
                };
                let continue_block = update.unwrap_or(*test);
                schedule_ids.push(self.cx.schedule_loop(
                    *fallthrough,
                    continue_block,
                    Some(*loop_block),
                ));

                let init_result = self.visit_value_block(*init, loc.clone(), None);
                let init_value =
                    Self::value_block_result_to_sequence(init_result, loc.clone());

                let test_value = self.visit_value_block(*test, loc.clone(), None).value;

                let update_value = update
                    .map(|u| self.visit_value_block(u, loc.clone(), None).value);

                let loop_body = {
                    let lid = loop_id.expect("Unexpected 'for' where the loop is already scheduled");
                    let b = self.cx.block(lid).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::For {
                        init: ReactiveValue::Sequence(Box::new(init_value)),
                        test: test_value,
                        update: update_value,
                        loop_: loop_body,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::ForOf {
                init,
                test,
                loop_block,
                fallthrough,
                id,
                loc,
            } => {
                let loop_id = if !self.cx.is_scheduled(*loop_block) && loop_block != fallthrough {
                    Some(*loop_block)
                } else {
                    None
                };
                let fallthrough_id = if !self.cx.is_scheduled(*fallthrough) {
                    Some(*fallthrough)
                } else {
                    None
                };
                schedule_ids.push(self.cx.schedule_loop(*fallthrough, *init, Some(*loop_block)));

                let init_result = self.visit_value_block(*init, loc.clone(), None);
                let init_value =
                    Self::value_block_result_to_sequence(init_result, loc.clone());

                let test_result = self.visit_value_block(*test, loc.clone(), None);
                let test_value =
                    Self::value_block_result_to_sequence(test_result, loc.clone());

                let loop_body = {
                    let lid = loop_id.expect("Unexpected 'for-of' where the loop is already scheduled");
                    let b = self.cx.block(lid).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::ForOf {
                        init: ReactiveValue::Sequence(Box::new(init_value)),
                        test: ReactiveValue::Sequence(Box::new(test_value)),
                        loop_: loop_body,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::ForIn {
                init,
                loop_block,
                fallthrough,
                id,
                loc,
            } => {
                let loop_id = if !self.cx.is_scheduled(*loop_block) && loop_block != fallthrough {
                    Some(*loop_block)
                } else {
                    None
                };
                let fallthrough_id = if !self.cx.is_scheduled(*fallthrough) {
                    Some(*fallthrough)
                } else {
                    None
                };
                schedule_ids.push(self.cx.schedule_loop(*fallthrough, *init, Some(*loop_block)));

                let init_result = self.visit_value_block(*init, loc.clone(), None);
                let init_value =
                    Self::value_block_result_to_sequence(init_result, loc.clone());

                let loop_body = {
                    let lid = loop_id.expect("Unexpected 'for-in' where the loop is already scheduled");
                    let b = self.cx.block(lid).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::ForIn {
                        init: ReactiveValue::Sequence(Box::new(init_value)),
                        loop_: loop_body,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Branch {
                test,
                consequent,
                alternate,
                id,
                loc,
                ..
            } => {
                let consequent_block: Option<ReactiveBlock> = if self.cx.is_scheduled(*consequent)
                {
                    let break_ = self.visit_break(*consequent, *id, loc.clone());
                    break_.map(|b| vec![b])
                } else {
                    let b = self.cx.block(*consequent).clone();
                    Some(self.traverse_block(&b))
                };

                let alternate_block: Option<ReactiveBlock> = if self.cx.is_scheduled(*alternate) {
                    panic!("Unexpected 'branch' where the alternate is already scheduled");
                } else {
                    let b = self.cx.block(*alternate).clone();
                    Some(self.traverse_block(&b))
                };

                block_value.push(terminal_statement(
                    ReactiveTerminal::If {
                        test: test.clone(),
                        consequent: consequent_block.unwrap_or_default(),
                        alternate: alternate_block,
                        id: *id,
                        loc: loc.clone(),
                    },
                    None,
                ));
            }
            Terminal::Label {
                block: label_block,
                fallthrough,
                id,
                loc,
            } => {
                let fallthrough_id = if self.cx.reachable(*fallthrough)
                    && !self.cx.is_scheduled(*fallthrough)
                {
                    Some(*fallthrough)
                } else {
                    None
                };
                if let Some(fid) = fallthrough_id {
                    schedule_ids.push(self.cx.schedule(fid));
                }

                let inner = {
                    assert!(
                        !self.cx.is_scheduled(*label_block),
                        "Unexpected 'label' where the block is already scheduled"
                    );
                    let b = self.cx.block(*label_block).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::Label {
                        block: inner,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Sequence { fallthrough, id, loc, .. }
            | Terminal::Optional { fallthrough, id, loc, .. }
            | Terminal::Ternary { fallthrough, id, loc, .. }
            | Terminal::Logical { fallthrough, id, loc, .. } => {
                let fallthrough_id = if !self.cx.is_scheduled(*fallthrough) {
                    Some(*fallthrough)
                } else {
                    None
                };
                if let Some(fid) = fallthrough_id {
                    schedule_ids.push(self.cx.schedule(fid));
                }

                let result = self.visit_value_block_terminal(&terminal);
                self.cx.unschedule_all(&schedule_ids);
                block_value.push(ReactiveStatement::Instruction(ReactiveInstruction {
                    id: *id,
                    lvalue: Some(result.place),
                    value: result.value,
                    effects: None,
                    loc: loc.clone(),
                }));

                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Goto {
                block: goto_block,
                variant,
                id,
                loc,
            } => match variant {
                GotoVariant::Break => {
                    if let Some(break_) = self.visit_break(*goto_block, *id, loc.clone()) {
                        block_value.push(break_);
                    }
                }
                GotoVariant::Continue => {
                    if let Some(continue_) = self.visit_continue(*goto_block, *id, loc.clone()) {
                        block_value.push(continue_);
                    }
                }
                GotoVariant::Try => {}
            },
            Terminal::MaybeThrow { continuation, .. } => {
                // ReactiveFunction does not model maybe-throw; flatten away.
                if !self.cx.is_scheduled(*continuation) {
                    let b = self.cx.block(*continuation).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Try {
                block: try_block,
                handler_binding,
                handler,
                fallthrough,
                id,
                loc,
            } => {
                let fallthrough_id = if self.cx.reachable(*fallthrough)
                    && !self.cx.is_scheduled(*fallthrough)
                {
                    Some(*fallthrough)
                } else {
                    None
                };
                if let Some(fid) = fallthrough_id {
                    schedule_ids.push(self.cx.schedule(fid));
                }
                self.cx.schedule_catch_handler(*handler);

                let block = {
                    let b = self.cx.block(*try_block).clone();
                    self.traverse_block(&b)
                };
                let handler_block = {
                    let b = self.cx.block(*handler).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                block_value.push(terminal_statement(
                    ReactiveTerminal::Try {
                        block,
                        handler_binding: handler_binding.clone(),
                        handler: handler_block,
                        id: *id,
                        loc: loc.clone(),
                    },
                    fallthrough_id.map(label),
                ));
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Scope {
                fallthrough,
                block: scope_block,
                scope,
                ..
            }
            | Terminal::PrunedScope {
                fallthrough,
                block: scope_block,
                scope,
                ..
            } => {
                let is_pruned = matches!(terminal, Terminal::PrunedScope { .. });
                let fallthrough_id = if !self.cx.is_scheduled(*fallthrough) {
                    Some(*fallthrough)
                } else {
                    None
                };
                if let Some(fid) = fallthrough_id {
                    schedule_ids.push(self.cx.schedule(fid));
                    self.cx.scope_fallthroughs.insert(fid);
                }

                let inner = {
                    assert!(
                        !self.cx.is_scheduled(*scope_block),
                        "Unexpected 'scope' where the block is already scheduled"
                    );
                    let b = self.cx.block(*scope_block).clone();
                    self.traverse_block(&b)
                };

                self.cx.unschedule_all(&schedule_ids);
                let scope_block_value = ReactiveScopeBlock {
                    scope: scope.clone(),
                    instructions: inner,
                };
                block_value.push(if is_pruned {
                    ReactiveStatement::PrunedScope(Box::new(scope_block_value))
                } else {
                    ReactiveStatement::Scope(Box::new(scope_block_value))
                });
                if let Some(fid) = fallthrough_id {
                    let b = self.cx.block(fid).clone();
                    self.visit_block(&b, block_value);
                }
            }
            Terminal::Unreachable { .. } => {
                // noop
            }
            Terminal::Unsupported { .. } => {
                panic!("Unexpected unsupported terminal");
            }
        }
    }

    /// `visitValueBlock`.
    fn visit_value_block(
        &mut self,
        block_id: BlockId,
        loc: SourceLocation,
        fallthrough: Option<BlockId>,
    ) -> ValueResult {
        let block = self.cx.block(block_id).clone();
        if let Some(ft) = fallthrough {
            assert_ne!(
                block_id, ft,
                "Did not expect to reach the fallthrough of a value block"
            );
        }
        match &block.terminal {
            Terminal::Branch { test, id, .. } => {
                if block.instructions.is_empty() {
                    return ValueResult {
                        block: block.id,
                        place: test.clone(),
                        value: ReactiveValue::Instruction(Box::new(InstructionValue::LoadLocal {
                            place: test.clone(),
                            loc: test.loc.clone(),
                        })),
                        id: *id,
                    };
                }
                Self::extract_value_block_result(&block.instructions, block.id, loc)
            }
            Terminal::Goto { .. } => {
                assert!(
                    !block.instructions.is_empty(),
                    "Unexpected empty block with `goto` terminal"
                );
                Self::extract_value_block_result(&block.instructions, block.id, loc)
            }
            Terminal::MaybeThrow { continuation, .. } => {
                let continuation_id = *continuation;
                let continuation_block = self.cx.block(continuation_id).clone();
                if continuation_block.instructions.is_empty()
                    && matches!(continuation_block.terminal, Terminal::Goto { .. })
                {
                    return Self::extract_value_block_result(
                        &block.instructions,
                        continuation_block.id,
                        loc,
                    );
                }
                let continuation = self.visit_value_block(continuation_id, loc.clone(), fallthrough);
                Self::wrap_with_sequence(
                    block.instructions.iter().map(reactive_instruction_from_hir).collect(),
                    continuation,
                    loc,
                )
            }
            _ => {
                let init = self.visit_value_block_terminal(&block.terminal);
                let final_ = self.visit_value_block(init.fallthrough, loc.clone(), None);
                let mut instructions: Vec<ReactiveInstruction> = block
                    .instructions
                    .iter()
                    .map(reactive_instruction_from_hir)
                    .collect();
                instructions.push(ReactiveInstruction {
                    id: init.id,
                    loc: loc.clone(),
                    lvalue: Some(init.place),
                    value: init.value,
                    effects: None,
                });
                Self::wrap_with_sequence(instructions, final_, loc)
            }
        }
    }

    /// `visitTestBlock`: visit a value terminal's test block and return its result
    /// plus the branch consequent/alternate.
    fn visit_test_block(
        &mut self,
        test_block_id: BlockId,
        loc: SourceLocation,
    ) -> (ValueResult, BlockId, BlockId) {
        let test = self.visit_value_block(test_block_id, loc, None);
        let test_block = self.cx.block(test.block).clone();
        match &test_block.terminal {
            Terminal::Branch {
                consequent,
                alternate,
                ..
            } => (test, *consequent, *alternate),
            other => panic!(
                "Expected a branch terminal for test block, got `{:?}`",
                std::mem::discriminant(other)
            ),
        }
    }

    /// `visitValueBlockTerminal`.
    fn visit_value_block_terminal(&mut self, terminal: &Terminal) -> TerminalResult {
        match terminal {
            Terminal::Sequence {
                block,
                fallthrough,
                id,
                loc,
            } => {
                let result = self.visit_value_block(*block, loc.clone(), Some(*fallthrough));
                TerminalResult {
                    value: result.value,
                    place: result.place,
                    fallthrough: *fallthrough,
                    id: *id,
                }
            }
            Terminal::Optional {
                optional,
                test,
                fallthrough,
                id,
                loc,
            } => {
                let (test_result, consequent_id, _alternate_id) =
                    self.visit_test_block(*test, loc.clone());
                let consequent =
                    self.visit_value_block(consequent_id, loc.clone(), Some(*fallthrough));
                // The branch loc is the test block's branch terminal loc; in the TS
                // this is `branch.loc`. We recover it from the test block.
                let branch_loc = match &self.cx.block(test_result.block).terminal {
                    Terminal::Branch { loc, .. } => loc.clone(),
                    _ => loc.clone(),
                };
                let call = ReactiveSequenceValue {
                    instructions: vec![ReactiveInstruction {
                        id: test_result.id,
                        loc: branch_loc,
                        lvalue: Some(test_result.place),
                        value: test_result.value,
                        effects: None,
                    }],
                    id: consequent.id,
                    value: consequent.value,
                    loc: loc.clone(),
                };
                TerminalResult {
                    place: consequent.place,
                    value: ReactiveValue::OptionalCall(Box::new(ReactiveOptionalCallValue {
                        optional: *optional,
                        value: ReactiveValue::Sequence(Box::new(call)),
                        id: *id,
                        loc: loc.clone(),
                    })),
                    fallthrough: *fallthrough,
                    id: *id,
                }
            }
            Terminal::Logical {
                operator,
                test,
                fallthrough,
                id,
                loc,
            } => {
                let (test_result, consequent_id, alternate_id) =
                    self.visit_test_block(*test, loc.clone());
                let left_final =
                    self.visit_value_block(consequent_id, loc.clone(), Some(*fallthrough));
                let left = ReactiveSequenceValue {
                    instructions: vec![ReactiveInstruction {
                        id: test_result.id,
                        loc: loc.clone(),
                        lvalue: Some(test_result.place),
                        value: test_result.value,
                        effects: None,
                    }],
                    id: left_final.id,
                    value: left_final.value,
                    loc: loc.clone(),
                };
                let right = self.visit_value_block(alternate_id, loc.clone(), Some(*fallthrough));
                let value = ReactiveLogicalValue {
                    operator: logical_operator(*operator),
                    left: ReactiveValue::Sequence(Box::new(left)),
                    right: right.value,
                    loc: loc.clone(),
                };
                TerminalResult {
                    place: left_final.place,
                    value: ReactiveValue::Logical(Box::new(value)),
                    fallthrough: *fallthrough,
                    id: *id,
                }
            }
            Terminal::Ternary {
                test,
                fallthrough,
                id,
                loc,
            } => {
                let (test_result, consequent_id, alternate_id) =
                    self.visit_test_block(*test, loc.clone());
                let consequent =
                    self.visit_value_block(consequent_id, loc.clone(), Some(*fallthrough));
                let alternate =
                    self.visit_value_block(alternate_id, loc.clone(), Some(*fallthrough));
                let value = ReactiveTernaryValue {
                    test: test_result.value,
                    consequent: consequent.value,
                    alternate: alternate.value,
                    loc: loc.clone(),
                };
                TerminalResult {
                    place: consequent.place,
                    value: ReactiveValue::Ternary(Box::new(value)),
                    fallthrough: *fallthrough,
                    id: *id,
                }
            }
            other => panic!(
                "Unsupported value block terminal `{:?}`",
                std::mem::discriminant(other)
            ),
        }
    }

    /// `visitBreak`.
    fn visit_break(
        &mut self,
        block: BlockId,
        id: InstructionId,
        loc: SourceLocation,
    ) -> Option<ReactiveStatement> {
        let target = self.cx.get_break_target(block).expect("Expected a break target");
        if self.cx.scope_fallthroughs.contains(&target.block) {
            assert!(
                matches!(target.kind, ReactiveTerminalTargetKind::Implicit),
                "Expected reactive scope to implicitly break to fallthrough"
            );
            return None;
        }
        Some(terminal_statement(
            ReactiveTerminal::Break {
                target: target.block,
                id,
                target_kind: target.kind,
                loc,
            },
            None,
        ))
    }

    /// `visitContinue`.
    fn visit_continue(
        &mut self,
        block: BlockId,
        id: InstructionId,
        loc: SourceLocation,
    ) -> Option<ReactiveStatement> {
        let target = self
            .cx
            .get_continue_target(block)
            .unwrap_or_else(|| panic!("Expected continue target to be scheduled for bb{}", block.as_u32()));
        Some(terminal_statement(
            ReactiveTerminal::Continue {
                target: target.block,
                id,
                target_kind: target.kind,
                loc,
            },
            None,
        ))
    }
}

/// Build a [`ReactiveInstruction`] from an HIR [`Instruction`], wrapping its value
/// in the base [`ReactiveValue::Instruction`] variant.
fn reactive_instruction_from_hir(
    instr: &crate::hir::instruction::Instruction,
) -> ReactiveInstruction {
    ReactiveInstruction {
        id: instr.id,
        lvalue: Some(instr.lvalue.clone()),
        value: ReactiveValue::Instruction(Box::new(instr.value.clone())),
        effects: instr.effects.clone(),
        loc: instr.loc.clone(),
    }
}

/// Build a `{kind: 'terminal', terminal, label}` statement.
fn terminal_statement(
    terminal: ReactiveTerminal,
    label: Option<TerminalLabel>,
) -> ReactiveStatement {
    ReactiveStatement::Terminal(Box::new(ReactiveTerminalStatement { terminal, label }))
}

/// `{id: fallthroughId, implicit: false}`.
fn label(id: BlockId) -> TerminalLabel {
    TerminalLabel {
        id,
        implicit: false,
    }
}

fn logical_operator(op: LogicalOperator) -> LogicalOperator {
    op
}

/// A control-flow target tracked on the scheduling stack (`ControlFlowTarget`).
#[derive(Clone, Debug)]
enum ControlFlowTarget {
    If { block: BlockId, id: usize },
    Loop {
        block: BlockId,
        // `ownsBlock` in the TS is recorded but the `unschedule` check
        // (`last.ownsBlock !== null`) is always true for loops (it is a boolean),
        // so the fallthrough is unconditionally unscheduled — the flag has no
        // behavioral effect and is omitted here.
        continue_block: BlockId,
        loop_block: Option<BlockId>,
        owns_loop: bool,
        id: usize,
    },
}

/// A resolved break/continue target.
struct ResolvedTarget {
    block: BlockId,
    kind: ReactiveTerminalTargetKind,
}

/// The `Context` from `BuildReactiveFunction.ts`: tracks emitted/scheduled blocks,
/// catch handlers, scope fallthroughs, and the control-flow stack.
struct Context<'a> {
    ir: &'a Hir,
    next_schedule_id: usize,
    emitted: HashSet<BlockId>,
    scope_fallthroughs: HashSet<BlockId>,
    scheduled: HashSet<BlockId>,
    catch_handlers: HashSet<BlockId>,
    control_flow_stack: Vec<ControlFlowTarget>,
}

impl<'a> Context<'a> {
    fn new(ir: &'a Hir) -> Self {
        Context {
            ir,
            next_schedule_id: 0,
            emitted: HashSet::new(),
            scope_fallthroughs: HashSet::new(),
            scheduled: HashSet::new(),
            catch_handlers: HashSet::new(),
            control_flow_stack: Vec::new(),
        }
    }

    fn block(&self, id: BlockId) -> &BasicBlock {
        self.ir.block(id).expect("block exists")
    }

    fn schedule_catch_handler(&mut self, block: BlockId) {
        self.catch_handlers.insert(block);
    }

    fn reachable(&self, id: BlockId) -> bool {
        !matches!(self.block(id).terminal, Terminal::Unreachable { .. })
    }

    /// `schedule(block, type)` — the `type` ('if'/'switch'/'case') only matters
    /// for the stack-entry kind, which for break/continue resolution behaves
    /// identically for all three (a non-loop target).
    fn schedule(&mut self, block: BlockId) -> usize {
        let id = self.next_schedule_id;
        self.next_schedule_id += 1;
        assert!(
            !self.scheduled.contains(&block),
            "Break block is already scheduled: bb{}",
            block.as_u32()
        );
        self.scheduled.insert(block);
        self.control_flow_stack
            .push(ControlFlowTarget::If { block, id });
        id
    }

    fn schedule_loop(
        &mut self,
        fallthrough_block: BlockId,
        continue_block: BlockId,
        loop_block: Option<BlockId>,
    ) -> usize {
        let id = self.next_schedule_id;
        self.next_schedule_id += 1;
        self.scheduled.insert(fallthrough_block);
        assert!(
            !self.scheduled.contains(&continue_block),
            "Continue block is already scheduled: bb{}",
            continue_block.as_u32()
        );
        self.scheduled.insert(continue_block);
        let mut owns_loop = false;
        if let Some(lb) = loop_block {
            owns_loop = !self.scheduled.contains(&lb);
            self.scheduled.insert(lb);
        }
        self.control_flow_stack.push(ControlFlowTarget::Loop {
            block: fallthrough_block,
            continue_block,
            loop_block,
            owns_loop,
            id,
        });
        id
    }

    fn unschedule(&mut self, schedule_id: usize) {
        let last = self
            .control_flow_stack
            .pop()
            .expect("Can only unschedule the last target");
        match last {
            ControlFlowTarget::If { block, id } => {
                assert_eq!(id, schedule_id, "Can only unschedule the last target");
                self.scheduled.remove(&block);
            }
            ControlFlowTarget::Loop {
                block,
                continue_block,
                loop_block,
                owns_loop,
                id,
                ..
            } => {
                assert_eq!(id, schedule_id, "Can only unschedule the last target");
                // The TS checks `last.ownsBlock !== null`; `ownsBlock` is always a
                // boolean for loops, so the fallthrough is always unscheduled here.
                self.scheduled.remove(&block);
                self.scheduled.remove(&continue_block);
                if owns_loop {
                    if let Some(lb) = loop_block {
                        self.scheduled.remove(&lb);
                    }
                }
            }
        }
    }

    fn unschedule_all(&mut self, schedule_ids: &[usize]) {
        for &id in schedule_ids.iter().rev() {
            self.unschedule(id);
        }
    }

    fn is_scheduled(&self, block: BlockId) -> bool {
        self.scheduled.contains(&block) || self.catch_handlers.contains(&block)
    }

    /// `getBreakTarget`.
    fn get_break_target(&self, block: BlockId) -> Option<ResolvedTarget> {
        let mut has_preceding_loop = false;
        for i in (0..self.control_flow_stack.len()).rev() {
            let target = &self.control_flow_stack[i];
            let (target_block, is_loop) = match target {
                ControlFlowTarget::If { block, .. } => (*block, false),
                ControlFlowTarget::Loop { block, .. } => (*block, true),
            };
            if target_block == block {
                let kind = if is_loop {
                    if has_preceding_loop {
                        ReactiveTerminalTargetKind::Labeled
                    } else {
                        ReactiveTerminalTargetKind::Unlabeled
                    }
                } else if i == self.control_flow_stack.len() - 1 {
                    ReactiveTerminalTargetKind::Implicit
                } else {
                    ReactiveTerminalTargetKind::Labeled
                };
                return Some(ResolvedTarget {
                    block: target_block,
                    kind,
                });
            }
            has_preceding_loop = has_preceding_loop || is_loop;
        }
        None
    }

    /// `getContinueTarget`.
    fn get_continue_target(&self, block: BlockId) -> Option<ResolvedTarget> {
        let mut has_preceding_loop = false;
        for i in (0..self.control_flow_stack.len()).rev() {
            let target = &self.control_flow_stack[i];
            if let ControlFlowTarget::Loop {
                block: target_block,
                continue_block,
                ..
            } = target
            {
                if *continue_block == block {
                    let kind = if has_preceding_loop {
                        ReactiveTerminalTargetKind::Labeled
                    } else if i == self.control_flow_stack.len() - 1 {
                        ReactiveTerminalTargetKind::Implicit
                    } else {
                        ReactiveTerminalTargetKind::Unlabeled
                    };
                    return Some(ResolvedTarget {
                        block: *target_block,
                        kind,
                    });
                }
            }
            let is_loop = matches!(target, ControlFlowTarget::Loop { .. });
            has_preceding_loop = has_preceding_loop || is_loop;
        }
        None
    }
}
