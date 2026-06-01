//! Shared CFG utilities used by the post-lowering passes
//! (`HIR/visitors.ts` + `HIR/HIRBuilder.ts`).
//!
//! The reverse-postorder / instruction-numbering / predecessor-marking helpers
//! already live in [`crate::build_hir::post`] (they run as part of stage-1
//! `build()`); this module re-exports them under the names the TS pipeline uses
//! and adds the operand iterator that [`super::inline_iife`] needs.

pub use crate::build_hir::post::{
    each_terminal_successor, mark_instruction_ids, mark_predecessors,
    remove_dead_do_while_statements, remove_unnecessary_try_catch, remove_unreachable_for_updates,
    reverse_postorder_blocks,
};

use crate::hir::instruction::Instruction;
use crate::hir::place::Place;
use crate::hir::terminal::Terminal;
use crate::hir::value::{
    ArrayElement, ArrayPatternItem, CallArgument, InstructionValue, JsxAttribute, JsxTag,
    MemoDependencyRoot, ObjectExpressionProperty, ObjectPatternProperty, ObjectPropertyKey, Pattern,
};

/// `terminalFallthrough(terminal)`: the fallthrough block id, if any. Identical
/// to [`Terminal::fallthrough`]; provided under the TS name for call-site parity.
pub fn terminal_fallthrough(terminal: &Terminal) -> Option<crate::hir::ids::BlockId> {
    terminal.fallthrough()
}

/// `eachInstructionValueOperand(value)`: the operand [`Place`]s referenced by an
/// instruction value, in TS order. Ported from `HIR/visitors.ts`.
pub fn each_instruction_value_operand(value: &InstructionValue) -> Vec<&Place> {
    let mut out: Vec<&Place> = Vec::new();
    match value {
        InstructionValue::NewExpression { callee, args, .. }
        | InstructionValue::CallExpression { callee, args, .. } => {
            out.push(callee);
            push_call_arguments(&mut out, args);
        }
        InstructionValue::BinaryExpression { left, right, .. } => {
            out.push(left);
            out.push(right);
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            ..
        } => {
            out.push(receiver);
            out.push(property);
            push_call_arguments(&mut out, args);
        }
        InstructionValue::DeclareContext { .. } | InstructionValue::DeclareLocal { .. } => {}
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            out.push(place);
        }
        InstructionValue::StoreLocal { value, .. } => out.push(value),
        InstructionValue::StoreContext { place, value, .. } => {
            // `instrValue.lvalue.place` in the TS; our model carries the store's
            // place directly.
            out.push(place);
            out.push(value);
        }
        InstructionValue::StoreGlobal { value, .. } => out.push(value),
        InstructionValue::Destructure { value, .. } => out.push(value),
        InstructionValue::PropertyLoad { object, .. } => out.push(object),
        InstructionValue::PropertyDelete { object, .. } => out.push(object),
        InstructionValue::PropertyStore { object, value, .. } => {
            out.push(object);
            out.push(value);
        }
        InstructionValue::ComputedLoad {
            object, property, ..
        } => {
            out.push(object);
            out.push(property);
        }
        InstructionValue::ComputedDelete {
            object, property, ..
        } => {
            out.push(object);
            out.push(property);
        }
        InstructionValue::ComputedStore {
            object,
            property,
            value,
            ..
        } => {
            out.push(object);
            out.push(property);
            out.push(value);
        }
        InstructionValue::UnaryExpression { value, .. } => out.push(value),
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            if let JsxTag::Place(place) = tag {
                out.push(place);
            }
            for attribute in props {
                match attribute {
                    JsxAttribute::Attribute { place, .. } => out.push(place),
                    JsxAttribute::Spread { argument } => out.push(argument),
                }
            }
            if let Some(children) = children {
                out.extend(children.iter());
            }
        }
        InstructionValue::JsxFragment { children, .. } => out.extend(children.iter()),
        InstructionValue::ObjectExpression { properties, .. } => {
            for property in properties {
                match property {
                    ObjectExpressionProperty::Property(property) => {
                        if let ObjectPropertyKey::Computed { name } = &property.key {
                            out.push(name);
                        }
                        out.push(&property.place);
                    }
                    ObjectExpressionProperty::Spread(spread) => out.push(&spread.place),
                }
            }
        }
        InstructionValue::ArrayExpression { elements, .. } => {
            for element in elements {
                match element {
                    ArrayElement::Place(place) => out.push(place),
                    ArrayElement::Spread(spread) => out.push(&spread.place),
                    ArrayElement::Hole => {}
                }
            }
        }
        InstructionValue::ObjectMethod { lowered_func, .. } => {
            out.extend(lowered_func.func.context.iter());
        }
        InstructionValue::FunctionExpression { lowered_func, .. } => {
            out.extend(lowered_func.func.context.iter());
        }
        InstructionValue::TaggedTemplateExpression { tag, .. } => out.push(tag),
        InstructionValue::TypeCastExpression { value, .. } => out.push(value),
        InstructionValue::TemplateLiteral { subexprs, .. } => out.extend(subexprs.iter()),
        InstructionValue::Await { value, .. } => out.push(value),
        InstructionValue::GetIterator { collection, .. } => out.push(collection),
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => {
            out.push(iterator);
            out.push(collection);
        }
        InstructionValue::NextPropertyOf { value, .. } => out.push(value),
        InstructionValue::PostfixUpdate { value, .. }
        | InstructionValue::PrefixUpdate { value, .. } => out.push(value),
        InstructionValue::StartMemoize { deps, .. } => {
            if let Some(deps) = deps {
                for dep in deps {
                    if let MemoDependencyRoot::NamedLocal { value, .. } = &dep.root {
                        out.push(value);
                    }
                }
            }
        }
        InstructionValue::FinishMemoize { decl, .. } => out.push(decl),
        InstructionValue::Debugger { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::JsxText { .. } => {}
    }
    out
}

fn push_call_arguments<'a>(out: &mut Vec<&'a Place>, args: &'a [CallArgument]) {
    for arg in args {
        match arg {
            CallArgument::Place(place) => out.push(place),
            CallArgument::Spread(spread) => out.push(&spread.place),
        }
    }
}

/// Mutable counterpart of [`each_instruction_value_operand`], yielding `&mut
/// Place` for each operand in the same order. Used by passes that need to rewrite
/// operand identifiers in place (e.g. propagating a temporary promotion).
pub fn each_instruction_value_operand_mut(value: &mut InstructionValue) -> Vec<&mut Place> {
    let mut out: Vec<&mut Place> = Vec::new();
    match value {
        InstructionValue::NewExpression { callee, args, .. }
        | InstructionValue::CallExpression { callee, args, .. } => {
            out.push(callee);
            push_call_arguments_mut(&mut out, args);
        }
        InstructionValue::BinaryExpression { left, right, .. } => {
            out.push(left);
            out.push(right);
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            ..
        } => {
            out.push(receiver);
            out.push(property);
            push_call_arguments_mut(&mut out, args);
        }
        InstructionValue::DeclareContext { .. } | InstructionValue::DeclareLocal { .. } => {}
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            out.push(place);
        }
        InstructionValue::StoreLocal { value, .. } => out.push(value),
        InstructionValue::StoreContext { place, value, .. } => {
            out.push(place);
            out.push(value);
        }
        InstructionValue::StoreGlobal { value, .. } => out.push(value),
        InstructionValue::Destructure { value, .. } => out.push(value),
        InstructionValue::PropertyLoad { object, .. } => out.push(object),
        InstructionValue::PropertyDelete { object, .. } => out.push(object),
        InstructionValue::PropertyStore { object, value, .. } => {
            out.push(object);
            out.push(value);
        }
        InstructionValue::ComputedLoad {
            object, property, ..
        } => {
            out.push(object);
            out.push(property);
        }
        InstructionValue::ComputedDelete {
            object, property, ..
        } => {
            out.push(object);
            out.push(property);
        }
        InstructionValue::ComputedStore {
            object,
            property,
            value,
            ..
        } => {
            out.push(object);
            out.push(property);
            out.push(value);
        }
        InstructionValue::UnaryExpression { value, .. } => out.push(value),
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            if let JsxTag::Place(place) = tag {
                out.push(place);
            }
            for attribute in props {
                match attribute {
                    JsxAttribute::Attribute { place, .. } => out.push(place),
                    JsxAttribute::Spread { argument } => out.push(argument),
                }
            }
            if let Some(children) = children {
                out.extend(children.iter_mut());
            }
        }
        InstructionValue::JsxFragment { children, .. } => out.extend(children.iter_mut()),
        InstructionValue::ObjectExpression { properties, .. } => {
            for property in properties {
                match property {
                    ObjectExpressionProperty::Property(property) => {
                        if let ObjectPropertyKey::Computed { name } = &mut property.key {
                            out.push(name);
                        }
                        out.push(&mut property.place);
                    }
                    ObjectExpressionProperty::Spread(spread) => out.push(&mut spread.place),
                }
            }
        }
        InstructionValue::ArrayExpression { elements, .. } => {
            for element in elements {
                match element {
                    ArrayElement::Place(place) => out.push(place),
                    ArrayElement::Spread(spread) => out.push(&mut spread.place),
                    ArrayElement::Hole => {}
                }
            }
        }
        InstructionValue::ObjectMethod { lowered_func, .. } => {
            out.extend(lowered_func.func.context.iter_mut());
        }
        InstructionValue::FunctionExpression { lowered_func, .. } => {
            out.extend(lowered_func.func.context.iter_mut());
        }
        InstructionValue::TaggedTemplateExpression { tag, .. } => out.push(tag),
        InstructionValue::TypeCastExpression { value, .. } => out.push(value),
        InstructionValue::TemplateLiteral { subexprs, .. } => out.extend(subexprs.iter_mut()),
        InstructionValue::Await { value, .. } => out.push(value),
        InstructionValue::GetIterator { collection, .. } => out.push(collection),
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => {
            out.push(iterator);
            out.push(collection);
        }
        InstructionValue::NextPropertyOf { value, .. } => out.push(value),
        InstructionValue::PostfixUpdate { value, .. }
        | InstructionValue::PrefixUpdate { value, .. } => out.push(value),
        InstructionValue::StartMemoize { deps, .. } => {
            if let Some(deps) = deps {
                for dep in deps {
                    if let MemoDependencyRoot::NamedLocal { value, .. } = &mut dep.root {
                        out.push(value);
                    }
                }
            }
        }
        InstructionValue::FinishMemoize { decl, .. } => out.push(decl),
        InstructionValue::Debugger { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::JsxText { .. } => {}
    }
    out
}

fn push_call_arguments_mut<'a>(out: &mut Vec<&'a mut Place>, args: &'a mut [CallArgument]) {
    for arg in args {
        match arg {
            CallArgument::Place(place) => out.push(place),
            CallArgument::Spread(spread) => out.push(&mut spread.place),
        }
    }
}

/// The single value place carried by a terminal, if any (`return`/`throw`). The
/// `if`/`branch`/`switch` test places and `maybe-throw` are not value-bearing in
/// the sense the rename helper needs (their tests are not the IIFE result).
pub fn terminal_value_mut(terminal: &mut Terminal) -> Option<&mut Place> {
    match terminal {
        Terminal::Return { value, .. } | Terminal::Throw { value, .. } => Some(value),
        Terminal::If { test, .. }
        | Terminal::Branch { test, .. }
        | Terminal::Switch { test, .. } => Some(test),
        _ => None,
    }
}

/// The mutable operand [`Place`]s of an instruction, in TS visitor order
/// (`eachInstructionOperand` = `eachInstructionValueOperand`). Identical
/// ordering to [`each_instruction_value_operand_mut`], lifted to the
/// [`Instruction`] level for the SSA/phi passes.
pub fn each_instruction_operand_mut(instr: &mut Instruction) -> Vec<&mut Place> {
    each_instruction_value_operand_mut(&mut instr.value)
}

/// The mutable lvalue [`Place`]s defined by an instruction value, in TS order
/// (`eachInstructionValueLValue`): the `StoreLocal`/`DeclareLocal`/`StoreContext`/
/// `DeclareContext` place, each destructured pattern place, or the update lvalue.
pub fn each_instruction_value_lvalue_mut(value: &mut InstructionValue) -> Vec<&mut Place> {
    let mut out: Vec<&mut Place> = Vec::new();
    match value {
        InstructionValue::DeclareContext { place, .. } => out.push(place),
        InstructionValue::StoreContext { place, .. } => out.push(place),
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => out.push(&mut lvalue.place),
        InstructionValue::Destructure { lvalue, .. } => {
            push_pattern_operands_mut(&mut out, &mut lvalue.pattern);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => out.push(lvalue),
        _ => {}
    }
    out
}

/// The lvalue [`Place`]s an instruction *value* assigns to
/// (`eachInstructionValueLValue`), non-mutating: the `StoreLocal`/`DeclareLocal`/
/// `StoreContext`/`DeclareContext` place, each destructured pattern place, or the
/// update lvalue.
pub fn each_instruction_value_lvalue(value: &InstructionValue) -> Vec<&Place> {
    let mut out: Vec<&Place> = Vec::new();
    match value {
        InstructionValue::DeclareContext { place, .. } => out.push(place),
        InstructionValue::StoreContext { place, .. } => out.push(place),
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => out.push(&lvalue.place),
        InstructionValue::Destructure { lvalue, .. } => {
            push_pattern_operands(&mut out, &lvalue.pattern);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => out.push(lvalue),
        _ => {}
    }
    out
}

/// The destructuring-pattern operand places (immutable), in
/// `mapPatternOperands`/`eachPatternOperand` order (array items then object
/// properties; holes skipped).
fn push_pattern_operands<'a>(out: &mut Vec<&'a Place>, pattern: &'a Pattern) {
    match pattern {
        Pattern::Array(array) => {
            for item in &array.items {
                match item {
                    ArrayPatternItem::Place(place) => out.push(place),
                    ArrayPatternItem::Spread(spread) => out.push(&spread.place),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &object.properties {
                match property {
                    ObjectPatternProperty::Property(property) => out.push(&property.place),
                    ObjectPatternProperty::Spread(spread) => out.push(&spread.place),
                }
            }
        }
    }
}

/// The mutable lvalue [`Place`]s of an instruction, in TS order
/// (`eachInstructionLValue`): `instr.lvalue` first, then the value-level lvalues.
pub fn each_instruction_lvalue_mut(instr: &mut Instruction) -> Vec<&mut Place> {
    let mut out: Vec<&mut Place> = vec![&mut instr.lvalue];
    out.extend(each_instruction_value_lvalue_mut(&mut instr.value));
    out
}

/// The lvalue [`Place`]s an instruction *value* assigns to, in `enterSSA`'s
/// `mapInstructionLValues` order (the value lvalues, then `instr.lvalue` last).
///
/// Distinct from [`each_instruction_lvalue_mut`] in *two* ways, matching the TS:
/// the value lvalues come *before* `instr.lvalue`, and `DeclareContext`/
/// `StoreContext` places are *not* redefined here (they are renamed as operands
/// instead — `mapInstructionLValues` omits the context cases).
pub fn map_instruction_lvalues_order_mut(instr: &mut Instruction) -> Vec<&mut Place> {
    let mut out: Vec<&mut Place> = Vec::new();
    match &mut instr.value {
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => out.push(&mut lvalue.place),
        InstructionValue::Destructure { lvalue, .. } => {
            push_pattern_operands_mut(&mut out, &mut lvalue.pattern);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => out.push(lvalue),
        _ => {}
    }
    out.push(&mut instr.lvalue);
    out
}

/// The destructuring-pattern operand places, in `mapPatternOperands`/
/// `eachPatternOperand` order (array items then object properties; holes
/// skipped).
fn push_pattern_operands_mut<'a>(out: &mut Vec<&'a mut Place>, pattern: &'a mut Pattern) {
    match pattern {
        Pattern::Array(array) => {
            for item in &mut array.items {
                match item {
                    ArrayPatternItem::Place(place) => out.push(place),
                    ArrayPatternItem::Spread(spread) => out.push(&mut spread.place),
                    ArrayPatternItem::Hole => {}
                }
            }
        }
        Pattern::Object(object) => {
            for property in &mut object.properties {
                match property {
                    ObjectPatternProperty::Property(property) => out.push(&mut property.place),
                    ObjectPatternProperty::Spread(spread) => out.push(&mut spread.place),
                }
            }
        }
    }
}

/// The mutable operand [`Place`]s of a terminal, in `mapTerminalOperands` /
/// `eachTerminalOperand` order: the `if`/`branch`/`switch` test (then each
/// non-default `switch` case test), the `return`/`throw` value, or a `try`
/// `handlerBinding`. All other terminals carry no value operands.
pub fn each_terminal_operand_mut(terminal: &mut Terminal) -> Vec<&mut Place> {
    let mut out: Vec<&mut Place> = Vec::new();
    match terminal {
        Terminal::If { test, .. } | Terminal::Branch { test, .. } => out.push(test),
        Terminal::Switch { test, cases, .. } => {
            out.push(test);
            for case in cases {
                if let Some(case_test) = &mut case.test {
                    out.push(case_test);
                }
            }
        }
        Terminal::Return { value, .. } | Terminal::Throw { value, .. } => out.push(value),
        Terminal::Try {
            handler_binding: Some(binding),
            ..
        } => out.push(binding),
        _ => {}
    }
    out
}

/// Non-mutating counterpart of [`each_terminal_operand_mut`]: the operand
/// [`Place`]s referenced by a terminal, in TS `eachTerminalOperand` order.
pub fn each_terminal_operand(terminal: &Terminal) -> Vec<&Place> {
    let mut out: Vec<&Place> = Vec::new();
    match terminal {
        Terminal::If { test, .. } | Terminal::Branch { test, .. } => out.push(test),
        Terminal::Switch { test, cases, .. } => {
            out.push(test);
            for case in cases {
                if let Some(case_test) = &case.test {
                    out.push(case_test);
                }
            }
        }
        Terminal::Return { value, .. } | Terminal::Throw { value, .. } => out.push(value),
        Terminal::Try {
            handler_binding: Some(binding),
            ..
        } => out.push(binding),
        _ => {}
    }
    out
}
