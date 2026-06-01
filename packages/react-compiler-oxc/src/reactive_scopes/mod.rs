//! The `ReactiveFunction` IR (stage 5): the nested, scoped tree representation
//! produced by `BuildReactiveFunction` from the post-`PropagateScopeDependenciesHIR`
//! [`HirFunction`](crate::hir::model::HirFunction), and its printer.
//!
//! - [`model`] — the [`ReactiveFunction`] data model and its `Reactive*` members.
//! - [`build`] — [`build_reactive_function`] (`BuildReactiveFunction`).
//! - [`print`] — [`print_reactive_function`] /
//!   [`print_reactive_function_with_outlined`] (`PrintReactiveFunction`).
//!
//! The post-`BuildReactiveFunction` ReactiveFunction passes (stage 6), in pipeline
//! order, each mutate the [`ReactiveFunction`] in place:
//! - [`prune_unused_labels`] (`PruneUnusedLabels`),
//! - [`prune_non_escaping_scopes`] (`PruneNonEscapingScopes`),
//! - [`prune_non_reactive_dependencies`] (`PruneNonReactiveDependencies`),
//! - [`prune_unused_scopes`] (`PruneUnusedScopes`),
//! - [`merge_reactive_scopes_that_invalidate_together`]
//!   (`MergeReactiveScopesThatInvalidateTogether`),
//! - [`prune_always_invalidating_scopes`] (`PruneAlwaysInvalidatingScopes`),
//! - [`propagate_early_returns`] (`PropagateEarlyReturns`),
//! - [`prune_unused_lvalues`] (`PruneUnusedLValues`),
//! - [`promote_used_temporaries`] (`PromoteUsedTemporaries`),
//! - [`extract_scope_declarations_from_destructuring`]
//!   (`ExtractScopeDeclarationsFromDestructuring`),
//! - [`stabilize_block_ids`] (`StabilizeBlockIds`),
//! - [`rename_variables`] (`RenameVariables`, returns the `uniqueIdentifiers` set
//!   codegen consumes),
//! - [`prune_hoisted_contexts`] (`PruneHoistedContexts`).
//!
//! Codegen (Stage 7) is out of scope here.

pub mod build;
pub mod extract_scope_declarations_from_destructuring;
pub mod merge_reactive_scopes_that_invalidate_together;
pub mod model;
pub mod print;
pub mod promote_used_temporaries;
pub mod propagate_early_returns;
pub mod prune_always_invalidating_scopes;
pub mod prune_hoisted_contexts;
pub mod prune_non_escaping_scopes;
pub mod prune_non_reactive_dependencies;
pub mod prune_unused_labels;
pub mod prune_unused_lvalues;
pub mod prune_unused_scopes;
pub mod reactive_place;
pub mod rename_variables;
pub mod stabilize_block_ids;
pub mod validate_preserved_manual_memoization;

pub use build::build_reactive_function;
pub use extract_scope_declarations_from_destructuring::extract_scope_declarations_from_destructuring;
pub use merge_reactive_scopes_that_invalidate_together::merge_reactive_scopes_that_invalidate_together;
pub use promote_used_temporaries::promote_used_temporaries;
pub use propagate_early_returns::propagate_early_returns;
pub use prune_always_invalidating_scopes::prune_always_invalidating_scopes;
pub use prune_hoisted_contexts::prune_hoisted_contexts;
pub use prune_non_escaping_scopes::prune_non_escaping_scopes;
pub use prune_non_reactive_dependencies::prune_non_reactive_dependencies;
pub use prune_unused_labels::prune_unused_labels;
pub use prune_unused_lvalues::prune_unused_lvalues;
pub use prune_unused_scopes::prune_unused_scopes;
pub use rename_variables::rename_variables;
pub use stabilize_block_ids::stabilize_block_ids;
pub use validate_preserved_manual_memoization::validate_preserved_manual_memoization;
pub use model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveLogicalValue,
    ReactiveOptionalCallValue, ReactiveScopeBlock, ReactiveSequenceValue, ReactiveStatement,
    ReactiveSwitchCase, ReactiveTernaryValue, ReactiveTerminal, ReactiveTerminalStatement,
    ReactiveTerminalTargetKind, ReactiveValue, TerminalLabel,
};
pub use print::{
    print_reactive_function, print_reactive_function_with_outlined, print_reactive_scope_summary,
};

#[cfg(test)]
mod tests {
    use super::model::*;
    use super::print::print_reactive_function;
    use crate::hir::ids::{IdentifierId, InstructionId, ScopeId, TypeId};
    use crate::hir::model::FunctionParam;
    use crate::hir::place::{Effect, Identifier, IdentifierName, MutableRange, Place, SourceLocation, Type};
    use crate::hir::terminal::{ReactiveScope, ScopeDeclaration};
    use crate::hir::value::{InstructionKind, InstructionValue, LValue, PrimitiveValue};

    fn temp_place(id: u32, type_: Type, effect: Effect, reactive: bool, scope: Option<u32>) -> Place {
        let mut identifier =
            Identifier::make_temporary(IdentifierId::new(id), TypeId::new(0), SourceLocation::Generated);
        identifier.type_ = type_;
        identifier.scope = scope.map(ScopeId::new);
        Place {
            identifier,
            effect,
            reactive,
            loc: SourceLocation::Generated,
        }
    }

    fn named_place(id: u32, name: &str, type_: Type, effect: Effect, reactive: bool) -> Place {
        let mut place = temp_place(id, type_, effect, reactive, None);
        place.identifier.name = Some(IdentifierName::Named {
            value: name.to_string(),
        });
        place
    }

    fn instruction(id: u32, lvalue: Place, value: InstructionValue) -> ReactiveStatement {
        ReactiveStatement::Instruction(ReactiveInstruction {
            id: InstructionId::new(id),
            lvalue: Some(lvalue),
            value: ReactiveValue::Instruction(Box::new(value)),
            effects: None,
            loc: SourceLocation::Generated,
        })
    }

    /// Build a small `ReactiveFunction` by hand mirroring the spec's example shape
    /// (a scope block + a `return freeze` terminal) and assert the exact printed
    /// text, exercising the function header, scope summary, instruction lines, and
    /// the `[i] return …` terminal.
    #[test]
    fn prints_scope_block_and_return() {
        // function f(<unknown> x$0{reactive}) { ... }
        let param = named_place(0, "x", Type::var(TypeId::new(0)), Effect::Unknown, true);

        // scope @0 [1:9] with one declaration ($2) and one dependency-free body
        // instruction `[1] $2_@0 = Array []`. The range is non-trivial (end >
        // start + 1) so the declared place's `[1:9]` range also prints.
        let mut scope = ReactiveScope::new(ScopeId::new(0), MutableRange {
            start: InstructionId::new(1),
            end: InstructionId::new(9),
        });
        scope.declarations.push((
            IdentifierId::new(2),
            ScopeDeclaration {
                identifier: temp_place(2, Type::Object {
                    shape_id: Some("BuiltInArray".to_string()),
                }, Effect::Store, true, Some(0)).identifier,
                scope: ScopeId::new(0),
            },
        ));

        let scope_decl_place =
            temp_place(2, Type::Object { shape_id: Some("BuiltInArray".to_string()) }, Effect::Store, true, Some(0));
        // Give the scope-declared place its merged range so it prints `[1:9]`.
        let mut scope_decl_place = scope_decl_place;
        scope_decl_place.identifier.mutable_range = MutableRange {
            start: InstructionId::new(1),
            end: InstructionId::new(9),
        };

        let scope_block = ReactiveScopeBlock {
            scope,
            instructions: vec![instruction(
                1,
                scope_decl_place.clone(),
                InstructionValue::ArrayExpression {
                    elements: Vec::new(),
                    loc: SourceLocation::Generated,
                },
            )],
        };

        // [2] return freeze $2_@0[1:9]:TObject<BuiltInArray>{reactive}
        let ret_place = {
            let mut p = scope_decl_place.clone();
            p.effect = Effect::Freeze;
            p
        };
        let ret = ReactiveStatement::Terminal(Box::new(ReactiveTerminalStatement {
            terminal: ReactiveTerminal::Return {
                value: ret_place,
                id: InstructionId::new(2),
                loc: SourceLocation::Generated,
            },
            label: None,
        }));

        let func = ReactiveFunction {
            loc: SourceLocation::Generated,
            id: Some("f".to_string()),
            name_hint: None,
            params: vec![FunctionParam::Place(param)],
            generator: false,
            async_: false,
            body: vec![ReactiveStatement::Scope(Box::new(scope_block)), ret],
            directives: Vec::new(),
        };

        let printed = print_reactive_function(&func);
        let expected = "function f(\n  <unknown> x$0{reactive},\n) {\n  scope @0 [1:9] dependencies=[] declarations=[$2_@0] reassignments=[] {\n    [1] store $2_@0[1:9]:TObject<BuiltInArray>{reactive} = Array []\n  }\n  [2] return freeze $2_@0[1:9]:TObject<BuiltInArray>{reactive}\n}";
        assert_eq!(printed, expected);
    }

    /// A no-param, no-scope function whose body is a single labeled `if` with a
    /// nested return, exercising the `bbN: [i] if (…) { … }` labeled-terminal form
    /// and the empty-params `function f(\n) {` header.
    #[test]
    fn prints_labeled_if_terminal() {
        let test = temp_place(1, Type::var(TypeId::new(0)), Effect::Read, true, None);
        let ret_value = temp_place(2, Type::Primitive, Effect::Freeze, false, None);
        let if_terminal = ReactiveStatement::Terminal(Box::new(ReactiveTerminalStatement {
            terminal: ReactiveTerminal::If {
                test,
                consequent: vec![ReactiveStatement::Terminal(Box::new(
                    ReactiveTerminalStatement {
                        terminal: ReactiveTerminal::Return {
                            value: ret_value,
                            id: InstructionId::new(3),
                            loc: SourceLocation::Generated,
                        },
                        label: None,
                    },
                ))],
                alternate: None,
                id: InstructionId::new(2),
                loc: SourceLocation::Generated,
            },
            label: Some(TerminalLabel {
                id: crate::hir::ids::BlockId::new(4),
                implicit: false,
            }),
        }));

        let func = ReactiveFunction {
            loc: SourceLocation::Generated,
            id: Some("f".to_string()),
            name_hint: None,
            params: Vec::new(),
            generator: false,
            async_: false,
            body: vec![if_terminal],
            directives: Vec::new(),
        };

        let printed = print_reactive_function(&func);
        let expected = "function f(\n) {\n  bb4: [2] if (read $1{reactive}) {\n    [3] return freeze $2:TPrimitive\n  }\n}";
        assert_eq!(printed, expected);
    }

    /// A `Sequence` reactive value prints `Sequence` + double-indented member
    /// instructions + the final value line, mirroring the oracle's value-block
    /// rendering.
    #[test]
    fn prints_sequence_value() {
        let lvalue = temp_place(5, Type::var(TypeId::new(0)), Effect::ConditionallyMutate, true, None);
        let seq = ReactiveSequenceValue {
            instructions: vec![ReactiveInstruction {
                id: InstructionId::new(2),
                lvalue: Some(temp_place(3, Type::var(TypeId::new(0)), Effect::ConditionallyMutate, true, None)),
                value: ReactiveValue::Instruction(Box::new(InstructionValue::LoadLocal {
                    place: named_place(4, "props", Type::var(TypeId::new(0)), Effect::Read, true),
                    loc: SourceLocation::Generated,
                })),
                effects: None,
                loc: SourceLocation::Generated,
            }],
            id: InstructionId::new(3),
            value: ReactiveValue::Instruction(Box::new(InstructionValue::LoadLocal {
                place: temp_place(3, Type::var(TypeId::new(0)), Effect::Read, true, None),
                loc: SourceLocation::Generated,
            })),
            loc: SourceLocation::Generated,
        };
        let body = vec![ReactiveStatement::Instruction(ReactiveInstruction {
            id: InstructionId::new(1),
            lvalue: Some(lvalue),
            value: ReactiveValue::Sequence(Box::new(seq)),
            effects: None,
            loc: SourceLocation::Generated,
        })];

        let func = ReactiveFunction {
            loc: SourceLocation::Generated,
            id: Some("C".to_string()),
            name_hint: None,
            params: Vec::new(),
            generator: false,
            async_: false,
            body,
            directives: Vec::new(),
        };

        // `[1] mutate? $5{reactive} = Sequence` then double-indented member +
        // final value line.
        let printed = print_reactive_function(&func);
        let expected = "function C(\n) {\n  [1] mutate? $5{reactive} = Sequence\n      [2] mutate? $3{reactive} = LoadLocal read props$4{reactive}\n      [3] LoadLocal read $3{reactive}\n}";
        assert_eq!(printed, expected);
    }

    /// `StoreLocal` lvalue rendering check (uses the shared `printInstructionValue`)
    /// to confirm the reactive printer threads through to the HIR value printer.
    #[test]
    fn prints_store_local_via_hir_printer() {
        let store = InstructionValue::StoreLocal {
            lvalue: LValue {
                place: named_place(2, "a", Type::Primitive, Effect::Store, true),
                kind: InstructionKind::Const,
            },
            value: temp_place(1, Type::Primitive, Effect::Read, true, None),
            type_annotation: None,
            loc: SourceLocation::Generated,
        };
        let body = vec![ReactiveStatement::Instruction(ReactiveInstruction {
            id: InstructionId::new(1),
            lvalue: Some(temp_place(3, Type::Primitive, Effect::ConditionallyMutate, true, None)),
            value: ReactiveValue::Instruction(Box::new(store)),
            effects: None,
            loc: SourceLocation::Generated,
        })];
        let func = ReactiveFunction {
            loc: SourceLocation::Generated,
            id: None,
            name_hint: None,
            params: Vec::new(),
            generator: false,
            async_: false,
            body,
            directives: Vec::new(),
        };
        let printed = print_reactive_function(&func);
        let expected = "function <unknown>(\n) {\n  [1] mutate? $3:TPrimitive{reactive} = StoreLocal Const store a$2:TPrimitive{reactive} = read $1:TPrimitive{reactive}\n}";
        assert_eq!(printed, expected);
    }

    /// `undefined` primitive and an anonymous-function header (`<unknown>`).
    #[test]
    fn prints_primitive_undefined_and_anon_header() {
        let body = vec![instruction(
            1,
            temp_place(0, Type::Primitive, Effect::ConditionallyMutate, false, None),
            InstructionValue::Primitive {
                value: PrimitiveValue::Undefined,
                loc: SourceLocation::Generated,
            },
        )];
        let func = ReactiveFunction {
            loc: SourceLocation::Generated,
            id: None,
            name_hint: None,
            params: Vec::new(),
            generator: false,
            async_: false,
            body,
            directives: Vec::new(),
        };
        let printed = print_reactive_function(&func);
        assert_eq!(
            printed,
            "function <unknown>(\n) {\n  [1] mutate? $0:TPrimitive = <undefined>\n}"
        );
    }
}
