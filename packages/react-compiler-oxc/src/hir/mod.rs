//! The React Compiler's High-level Intermediate Representation (HIR) data
//! model, ported from `packages/react-compiler/src/HIR/HIR.ts` (and the minimal
//! `Type` lattice from `Types.ts`).
//!
//! The HIR is a control-flow graph of basic blocks. Each [`BasicBlock`] holds a
//! list of [`Instruction`]s and ends in one [`Terminal`]. Instructions are
//! flattened expressions whose operands are always [`Place`]s referencing an
//! [`Identifier`]. See the submodules for the per-area types:
//!
//! - [`ids`] — opaque newtyped ids + the monotonic [`IdAllocator`].
//! - [`place`] — [`SourceLocation`], [`Type`], [`Identifier`], [`Place`].
//! - [`value`] — [`InstructionValue`] and its constituents.
//! - [`instruction`] — [`Instruction`] + the stubbed [`AliasingEffect`].
//! - [`terminal`] — all [`Terminal`] variants.
//! - [`model`] — [`HirFunction`], [`Hir`], [`BasicBlock`], [`Phi`].
//!
//! Reactive* IR types and full type inference are out of scope for stage 1.

pub mod ids;
pub mod instruction;
pub mod model;
pub mod place;
pub mod print;
pub mod terminal;
pub mod type_checks;
pub mod value;

pub use ids::{BlockId, DeclarationId, IdAllocator, IdentifierId, InstructionId, ScopeId, TypeId};
pub use instruction::{AliasingEffect, Instruction};
pub use model::{
    BasicBlock, BlockKind, BlockSet, FunctionParam, Hir, HirFunction, Phi, PhiOperands,
    ReactFunctionType,
};
pub use place::{
    Effect, Identifier, IdentifierName, MutableRange, Place, PropertyName, SourceLocation, Type,
    ValueKind, ValueReason,
};
pub use print::{
    print_aliasing_effect, print_function, print_function_with_outlined, print_hir,
    print_identifier, print_instruction, print_instruction_value, print_lvalue,
    print_manual_memo_dependency, print_phi, print_place, print_terminal, print_type,
};
pub use terminal::{
    GotoVariant, LogicalOperator, ReactiveScope, ReactiveScopeDependency, ReturnVariant,
    ScopeDeclaration, SwitchCase, Terminal,
};
pub use value::{
    ArrayElement, ArrayPattern, ArrayPatternItem, BuiltinTag, CallArgument, DependencyPathEntry,
    FunctionExpressionType, InstructionKind, InstructionValue, JsxAttribute, JsxTag, LValue,
    LValuePattern, LoweredFunction, ManualMemoDependency, MemoDependencyRoot, NonLocalBinding,
    ObjectExpressionProperty, ObjectPattern, ObjectPatternProperty, ObjectProperty,
    ObjectPropertyKey, Pattern, PrimitiveValue, PropertyLiteral, PropertyType, SpreadPattern,
    TemplateQuasi, TypeAnnotationKind, VariableBinding,
};

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny [`Environment`]-like id source for building HIR by hand in tests,
    /// mirroring the `next*Id` counters the real lowering threads through.
    struct Ids {
        identifiers: IdAllocator,
        blocks: IdAllocator,
        instructions: IdAllocator,
        types: IdAllocator,
    }

    impl Ids {
        fn new() -> Self {
            Ids {
                identifiers: IdAllocator::new(),
                blocks: IdAllocator::new(),
                instructions: IdAllocator::new(),
                types: IdAllocator::new(),
            }
        }

        fn next_identifier(&mut self) -> IdentifierId {
            IdentifierId::new(self.identifiers.alloc())
        }

        fn next_block(&mut self) -> BlockId {
            BlockId::new(self.blocks.alloc())
        }

        fn next_instruction(&mut self) -> InstructionId {
            InstructionId::new(self.instructions.alloc())
        }

        fn next_type(&mut self) -> TypeId {
            TypeId::new(self.types.alloc())
        }

        /// A fresh temporary place with `Read` effect, mirroring the common
        /// lowering pattern of allocating an identifier + wrapping in a Place.
        fn temp_place(&mut self) -> Place {
            let id = self.next_identifier();
            let type_id = self.next_type();
            Place {
                identifier: Identifier::make_temporary(id, type_id, SourceLocation::Generated),
                effect: Effect::Read,
                reactive: false,
                loc: SourceLocation::Generated,
            }
        }
    }

    #[test]
    fn id_allocator_post_increments() {
        let mut alloc = IdAllocator::new();
        assert_eq!(alloc.peek(), 0);
        assert_eq!(alloc.alloc(), 0);
        assert_eq!(alloc.alloc(), 1);
        assert_eq!(alloc.peek(), 2);

        let mut from_five = IdAllocator::starting_at(5);
        assert_eq!(from_five.alloc(), 5);
        assert_eq!(from_five.alloc(), 6);
    }

    #[test]
    fn temporary_identifier_has_no_name_and_unknown_type() {
        let id = IdentifierId::new(7);
        let identifier = Identifier::make_temporary(id, TypeId::new(0), SourceLocation::Generated);
        assert_eq!(identifier.id, IdentifierId::new(7));
        assert_eq!(identifier.declaration_id, DeclarationId::new(7));
        assert!(identifier.name.is_none());
        assert!(matches!(identifier.type_, Type::Var { .. }));
        assert_eq!(identifier.mutable_range, MutableRange::default());
    }

    #[test]
    fn enum_string_spellings_match_ts() {
        assert_eq!(Effect::ConditionallyMutate.as_str(), "mutate?");
        assert_eq!(
            Effect::ConditionallyMutateIterator.as_str(),
            "mutate-iterator?"
        );
        assert_eq!(Effect::Unknown.as_str(), "<unknown>");
        assert_eq!(InstructionKind::HoistedFunction.as_str(), "HoistedFunction");
        assert_eq!(GotoVariant::Continue.as_str(), "Continue");
        assert_eq!(ReturnVariant::Implicit.as_str(), "Implicit");
        assert_eq!(LogicalOperator::NullCoalescing.as_str(), "??");
        assert_eq!(BlockKind::Sequence.as_str(), "sequence");
        assert_eq!(ReactFunctionType::Component.as_str(), "component");
        assert_eq!(
            FunctionExpressionType::ArrowFunctionExpression.as_str(),
            "ArrowFunctionExpression"
        );
    }

    #[test]
    fn block_kind_statement_vs_expression() {
        assert!(BlockKind::Block.is_statement());
        assert!(BlockKind::Catch.is_statement());
        assert!(!BlockKind::Block.is_expression());
        assert!(BlockKind::Value.is_expression());
        assert!(BlockKind::Loop.is_expression());
        assert!(BlockKind::Sequence.is_expression());
        assert!(!BlockKind::Value.is_statement());
    }

    #[test]
    fn terminal_id_and_fallthrough_accessors() {
        let ret = Terminal::Return {
            return_variant: ReturnVariant::Void,
            value: {
                let mut ids = Ids::new();
                ids.temp_place()
            },
            id: InstructionId::new(3),
            effects: None,
            loc: SourceLocation::Generated,
        };
        assert_eq!(ret.id(), InstructionId::new(3));
        assert_eq!(ret.fallthrough(), None);

        let if_term = Terminal::If {
            test: {
                let mut ids = Ids::new();
                ids.temp_place()
            },
            consequent: BlockId::new(1),
            alternate: BlockId::new(2),
            fallthrough: BlockId::new(3),
            id: InstructionId::new(4),
            loc: SourceLocation::Generated,
        };
        assert_eq!(if_term.id(), InstructionId::new(4));
        assert_eq!(if_term.fallthrough(), Some(BlockId::new(3)));
    }

    /// Build a tiny `HIRFunction` by hand:
    ///
    /// ```js
    /// function f() { return 42; }
    /// ```
    ///
    /// Lowers to a single entry block whose terminal returns a temporary that
    /// holds the primitive `42`.
    #[test]
    fn build_tiny_hir_function_by_hand() {
        let mut ids = Ids::new();

        // The function's `returns` place is allocated first in the TS lowering.
        let returns = ids.temp_place();

        let entry = ids.next_block();

        // `$N = Primitive 42`
        let primitive_place = ids.temp_place();
        let primitive = Instruction {
            id: ids.next_instruction(),
            lvalue: primitive_place.clone(),
            value: InstructionValue::Primitive {
                value: PrimitiveValue::Number(42.0),
                loc: SourceLocation::Generated,
            },
            loc: SourceLocation::Generated,
            effects: None,
        };

        let block = BasicBlock {
            kind: BlockKind::Block,
            id: entry,
            instructions: vec![primitive],
            terminal: Terminal::Return {
                return_variant: ReturnVariant::Explicit,
                value: primitive_place,
                id: ids.next_instruction(),
                effects: None,
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        };

        let mut body = Hir::new(entry);
        body.push_block(block);

        let func = HirFunction {
            loc: SourceLocation::Generated,
            id: Some("f".to_string()),
            name_hint: None,
            fn_type: ReactFunctionType::Other,
            params: Vec::new(),
            return_type_annotation: None,
            returns,
            context: Vec::new(),
            body,
            generator: false,
            async_: false,
            directives: Vec::new(),
            aliasing_effects: None,
            outlined: Vec::new(),
        };

        assert_eq!(func.id.as_deref(), Some("f"));
        assert_eq!(func.body.len(), 1);
        assert_eq!(func.body.entry, entry);

        let entry_block = func.body.block(entry).expect("entry block present");
        assert_eq!(entry_block.instructions.len(), 1);
        assert!(matches!(
            entry_block.instructions[0].value,
            InstructionValue::Primitive {
                value: PrimitiveValue::Number(n),
                ..
            } if n == 42.0
        ));
        assert!(matches!(
            entry_block.terminal,
            Terminal::Return {
                return_variant: ReturnVariant::Explicit,
                ..
            }
        ));

        // The single block iterates in insertion order.
        assert_eq!(func.body.blocks().len(), 1);
        assert_eq!(func.body.blocks()[0].id, entry);
    }

    #[test]
    fn hir_preserves_block_insertion_order() {
        let mut body = Hir::new(BlockId::new(0));
        for raw in [0u32, 3, 1, 2] {
            let id = BlockId::new(raw);
            body.push_block(BasicBlock {
                kind: BlockKind::Block,
                id,
                instructions: Vec::new(),
                terminal: Terminal::Unreachable {
                    id: InstructionId::new(raw),
                    loc: SourceLocation::Generated,
                },
                preds: Default::default(),
                phis: Vec::new(),
            });
        }
        let order: Vec<u32> = body.blocks().iter().map(|b| b.id.as_u32()).collect();
        assert_eq!(order, vec![0, 3, 1, 2]);
        // Lookup still works regardless of insertion order.
        assert!(body.block(BlockId::new(3)).is_some());
        assert!(body.block(BlockId::new(9)).is_none());
    }

    #[test]
    #[should_panic(expected = "duplicate block id")]
    fn hir_rejects_duplicate_block_ids() {
        let mut body = Hir::new(BlockId::new(0));
        let make = |id: u32| BasicBlock {
            kind: BlockKind::Block,
            id: BlockId::new(id),
            instructions: Vec::new(),
            terminal: Terminal::Unreachable {
                id: InstructionId::new(id),
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        };
        body.push_block(make(0));
        body.push_block(make(0));
    }

    #[test]
    fn non_local_binding_shapes() {
        let import = NonLocalBinding::ImportSpecifier {
            name: "baz".to_string(),
            module: "foo".to_string(),
            imported: "bar".to_string(),
        };
        assert_eq!(
            import,
            NonLocalBinding::ImportSpecifier {
                name: "baz".to_string(),
                module: "foo".to_string(),
                imported: "bar".to_string(),
            }
        );
        let global = NonLocalBinding::Global {
            name: "React".to_string(),
        };
        assert_ne!(import, global);
    }
}
