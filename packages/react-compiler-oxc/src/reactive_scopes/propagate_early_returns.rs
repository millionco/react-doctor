//! `propagateEarlyReturns`, ported from
//! `packages/react-compiler/src/ReactiveScopes/PropagateEarlyReturns.ts`.
//!
//! Ensures reactive scopes honor early-return semantics across memoization. For
//! the outermost reactive scope that (transitively) contains a `return`:
//! - the scope is labeled and given a synthesized early-return temporary,
//! - the scope's instructions are prefixed with a `Symbol.for('react.…')` sentinel
//!   assignment to that temporary and wrapped in a labeled block,
//! - every `return` within the scope becomes `t = value; break <label>`.
//!
//! Post-order scope traversal; `return`s are rewritten during terminal visitation.
//! The synthesized temporaries draw fresh identifier ids and the label draws a
//! fresh block id from the shared id allocators ([`PassContext`]), matching
//! `env.nextIdentifierId` / `env.nextBlockId` in the TS.
//!
//! NOTE: on the current fixture corpus no early return survives inside a reactive
//! scope to this point, so this pass is a structural no-op there; it is ported
//! faithfully for completeness and forward stages.

use crate::hir::ids::{InstructionId, TypeId};
use crate::hir::place::{Effect, Identifier, IdentifierName, Place, SourceLocation};
use crate::hir::terminal::EarlyReturnValue;
use crate::hir::value::{
    CallArgument, InstructionKind, InstructionValue, LValue, NonLocalBinding, PrimitiveValue,
    PropertyLiteral,
};
use crate::passes::PassContext;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveTerminalStatement, ReactiveValue, TerminalLabel,
};

/// `react.early_return_sentinel` (`EARLY_RETURN_SENTINEL` in `CodegenReactiveFunction`).
const EARLY_RETURN_SENTINEL: &str = "react.early_return_sentinel";

/// `propagateEarlyReturns(fn)`.
pub fn propagate_early_returns(func: &mut ReactiveFunction, ctx: &mut PassContext) {
    let mut transform = Transform { ctx };
    let mut state = State {
        within_reactive_scope: false,
        early_return_value: None,
    };
    transform.visit_block(&mut func.body, &mut state);
}

#[derive(Clone)]
struct State {
    /// Are we within a reactive scope?
    within_reactive_scope: bool,
    /// The early-return information bubbled up to the outermost reactive scope.
    early_return_value: Option<EarlyReturnValue>,
}

struct Transform<'a> {
    ctx: &'a mut PassContext,
}

impl Transform<'_> {
    fn visit_block(&mut self, block: &mut ReactiveBlock, state: &mut State) {
        // `ReactiveFunctionTransform.traverseBlock` with replace-many support for the
        // terminal rewrite.
        let owned: Vec<ReactiveStatement> = std::mem::take(block);
        let mut next: Vec<ReactiveStatement> = Vec::with_capacity(owned.len());
        for stmt in owned {
            match stmt {
                ReactiveStatement::Instruction(instruction) => {
                    next.push(ReactiveStatement::Instruction(instruction));
                }
                ReactiveStatement::Scope(mut scope) => {
                    self.visit_scope(&mut scope, state);
                    next.push(ReactiveStatement::Scope(scope));
                }
                ReactiveStatement::PrunedScope(mut scope) => {
                    // `transformPrunedScope` (base): traverse the body with the same
                    // state.
                    self.visit_block(&mut scope.instructions, state);
                    next.push(ReactiveStatement::PrunedScope(scope));
                }
                ReactiveStatement::Terminal(term_stmt) => {
                    match self.transform_terminal(*term_stmt, state) {
                        TerminalResult::Keep(stmt) => {
                            next.push(ReactiveStatement::Terminal(Box::new(stmt)))
                        }
                        TerminalResult::ReplaceMany(stmts) => next.extend(stmts),
                    }
                }
            }
        }
        *block = next;
    }

    /// `visitScope`: post-order; the outermost reactive scope wrapping an early
    /// return is rewritten.
    fn visit_scope(&mut self, scope_block: &mut ReactiveScopeBlock, parent_state: &mut State) {
        // An earlier pass may have already created an early return.
        if scope_block.scope.early_return_value.is_some() {
            return;
        }

        let mut inner_state = State {
            within_reactive_scope: true,
            early_return_value: parent_state.early_return_value.clone(),
        };
        self.visit_block(&mut scope_block.instructions, &mut inner_state);

        let Some(early_return_value) = inner_state.early_return_value.clone() else {
            return;
        };

        if !parent_state.within_reactive_scope {
            // Outermost scope wrapping an early return.
            scope_block.scope.early_return_value = Some(early_return_value.clone());
            // Add the early-return value as a declaration of the scope.
            let decl_identifier = early_return_value.value.clone();
            scope_block.scope.declarations.push((
                decl_identifier.id,
                crate::hir::terminal::ScopeDeclaration {
                    identifier: decl_identifier,
                    scope: scope_block.scope.id,
                },
            ));

            let loc = early_return_value.loc.clone();
            let instructions = std::mem::take(&mut scope_block.instructions);

            // Allocation order matches PropagateEarlyReturns.ts:162-165: the
            // sentinel (MethodCall result) temp gets the LOWEST identifier id,
            // then symbol/for/arg in that order. The instruction list below is
            // emitted in a different order, but identifier ids follow allocation
            // order, which drives the printed `$N` ids and later t0/t1 renaming.
            let sentinel_temp = self.create_temporary_place(&loc);
            let symbol_temp = self.create_temporary_place(&loc);
            let for_temp = self.create_temporary_place(&loc);
            let arg_temp = self.create_temporary_place(&loc);

            let mut new_instructions: ReactiveBlock = Vec::new();
            // [0] Symbol
            new_instructions.push(instruction(
                Some(symbol_temp.clone()),
                InstructionValue::LoadGlobal {
                    binding: NonLocalBinding::Global {
                        name: "Symbol".to_string(),
                    },
                    loc: loc.clone(),
                },
                loc.clone(),
            ));
            // [0] Symbol.for
            new_instructions.push(instruction(
                Some(for_temp.clone()),
                InstructionValue::PropertyLoad {
                    object: symbol_temp.clone(),
                    property: PropertyLiteral::String("for".to_string()),
                    loc: loc.clone(),
                },
                loc.clone(),
            ));
            // [0] 'react.early_return_sentinel'
            new_instructions.push(instruction(
                Some(arg_temp.clone()),
                InstructionValue::Primitive {
                    value: PrimitiveValue::String(EARLY_RETURN_SENTINEL.to_string()),
                    loc: loc.clone(),
                },
                loc.clone(),
            ));
            // [0] Symbol.for('react.early_return_sentinel')
            new_instructions.push(instruction(
                Some(sentinel_temp.clone()),
                InstructionValue::MethodCall {
                    receiver: symbol_temp.clone(),
                    property: for_temp.clone(),
                    args: vec![CallArgument::Place(arg_temp.clone())],
                    loc: loc.clone(),
                },
                loc.clone(),
            ));
            // [0] let <earlyReturnValue> = sentinel
            new_instructions.push(instruction(
                None,
                InstructionValue::StoreLocal {
                    lvalue: LValue {
                        place: Place {
                            identifier: early_return_value.value.clone(),
                            effect: Effect::ConditionallyMutate,
                            reactive: true,
                            loc: loc.clone(),
                        },
                        kind: InstructionKind::Let,
                    },
                    value: sentinel_temp.clone(),
                    type_annotation: None,
                    loc: loc.clone(),
                },
                loc.clone(),
            ));
            // labeled block wrapping the original instructions
            new_instructions.push(ReactiveStatement::Terminal(Box::new(
                ReactiveTerminalStatement {
                    terminal: ReactiveTerminal::Label {
                        block: instructions,
                        id: InstructionId::new(0),
                        loc: SourceLocation::Generated,
                    },
                    label: Some(TerminalLabel {
                        id: early_return_value.label,
                        implicit: false,
                    }),
                },
            )));

            scope_block.instructions = new_instructions;
        } else {
            // Not the outermost scope: bubble the early-return info upward.
            parent_state.early_return_value = Some(early_return_value);
        }
    }

    fn transform_terminal(
        &mut self,
        mut stmt: ReactiveTerminalStatement,
        state: &mut State,
    ) -> TerminalResult {
        if state.within_reactive_scope {
            if let ReactiveTerminal::Return { value, .. } = &stmt.terminal {
                let loc = value.loc.clone();
                let return_value = value.clone();
                let early_return_value = match &state.early_return_value {
                    Some(existing) => existing.clone(),
                    None => {
                        let mut identifier = self.create_temporary_place(&loc).identifier;
                        promote_temporary(&mut identifier);
                        EarlyReturnValue {
                            label: self.ctx.next_block_id(),
                            loc: loc.clone(),
                            value: identifier,
                        }
                    }
                };
                state.early_return_value = Some(early_return_value.clone());
                let store = instruction(
                    None,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: Place {
                                identifier: early_return_value.value.clone(),
                                effect: Effect::Capture,
                                reactive: true,
                                loc: loc.clone(),
                            },
                            kind: InstructionKind::Reassign,
                        },
                        value: return_value,
                        type_annotation: None,
                        loc: loc.clone(),
                    },
                    loc.clone(),
                );
                let break_ = ReactiveStatement::Terminal(Box::new(ReactiveTerminalStatement {
                    terminal: ReactiveTerminal::Break {
                        target: early_return_value.label,
                        id: InstructionId::new(0),
                        target_kind: crate::reactive_scopes::ReactiveTerminalTargetKind::Labeled,
                        loc,
                    },
                    label: None,
                }));
                return TerminalResult::ReplaceMany(vec![store, break_]);
            }
        }
        // `traverseTerminal`: recurse into nested blocks.
        self.traverse_terminal(&mut stmt.terminal, state);
        TerminalResult::Keep(stmt)
    }

    fn traverse_terminal(&mut self, terminal: &mut ReactiveTerminal, state: &mut State) {
        match terminal {
            ReactiveTerminal::Break { .. }
            | ReactiveTerminal::Continue { .. }
            | ReactiveTerminal::Return { .. }
            | ReactiveTerminal::Throw { .. } => {}
            ReactiveTerminal::For { loop_, .. }
            | ReactiveTerminal::ForOf { loop_, .. }
            | ReactiveTerminal::ForIn { loop_, .. }
            | ReactiveTerminal::DoWhile { loop_, .. }
            | ReactiveTerminal::While { loop_, .. } => self.visit_block(loop_, state),
            ReactiveTerminal::If {
                consequent,
                alternate,
                ..
            } => {
                self.visit_block(consequent, state);
                if let Some(alternate) = alternate {
                    self.visit_block(alternate, state);
                }
            }
            ReactiveTerminal::Switch { cases, .. } => {
                for case in cases {
                    if let Some(block) = &mut case.block {
                        self.visit_block(block, state);
                    }
                }
            }
            ReactiveTerminal::Label { block, .. } => self.visit_block(block, state),
            ReactiveTerminal::Try { block, handler, .. } => {
                self.visit_block(block, state);
                self.visit_block(handler, state);
            }
        }
    }

    /// `createTemporaryPlace(env, loc)`.
    fn create_temporary_place(&mut self, loc: &SourceLocation) -> Place {
        let id = self.ctx.next_identifier_id();
        Place {
            identifier: Identifier::make_temporary(id, TypeId::new(0), loc.clone()),
            effect: Effect::Unknown,
            reactive: false,
            loc: SourceLocation::Generated,
        }
    }
}

enum TerminalResult {
    Keep(ReactiveTerminalStatement),
    ReplaceMany(Vec<ReactiveStatement>),
}

/// Build an instruction statement with `id = 0` (the TS uses `makeInstructionId(0)`
/// for synthesized instructions).
fn instruction(
    lvalue: Option<Place>,
    value: InstructionValue,
    loc: SourceLocation,
) -> ReactiveStatement {
    ReactiveStatement::Instruction(ReactiveInstruction {
        id: InstructionId::new(0),
        lvalue,
        value: ReactiveValue::Instruction(Box::new(value)),
        effects: None,
        loc,
    })
}

/// `promoteTemporary(identifier)`: name a temporary `#t<declarationId>`.
fn promote_temporary(identifier: &mut Identifier) {
    identifier.name = Some(IdentifierName::Promoted {
        value: format!("#t{}", identifier.declaration_id.as_u32()),
    });
}
