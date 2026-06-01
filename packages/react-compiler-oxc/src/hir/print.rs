//! Textual printer for the HIR, ported from
//! `packages/react-compiler/src/HIR/PrintHIR.ts`.
//!
//! [`print_function`] reproduces the React Compiler's raw post-lowering HIR dump
//! byte-for-byte: the function header (`name params: returns`), each
//! `bbN (kind):` block with its predecessors / phis / instructions / terminal,
//! every instruction-value form, every terminal form, and nested-function
//! indentation with the `@context[...]` / `@aliasingEffects=[]` annotations.
//!
//! At stage 1 every identifier carries the default [`Type::Var`], which
//! [`print_type`] renders as the empty string; the leading `<unknown>` seen in a
//! dump is the place's [`Effect::Unknown`], not its type (see `HIR.ts:1514`).

use super::instruction::{AliasingEffect, Instruction};
use super::model::{FunctionParam, Hir, HirFunction};
use super::place::{Identifier, IdentifierName, Place, Type};
use super::terminal::{GotoVariant, ReactiveScope, ReactiveScopeDependency, Terminal};
use super::value::{
    ArrayElement, ArrayPatternItem, InstructionValue, JsxAttribute, JsxTag, LValue, LValuePattern,
    ManualMemoDependency, MemoDependencyRoot, NonLocalBinding, ObjectExpressionProperty,
    ObjectPatternProperty, ObjectPropertyKey, Pattern, PrimitiveValue, PropertyLiteral,
};

/// Print a function and all of its outlined functions
/// (`printFunctionWithOutlined`): the main function body, then one
/// `\nfunction <id>:\n<body>` block per outlined function (in outlining order).
///
/// Outlined functions are produced by `OutlineFunctions`
/// (`enableFunctionOutlining`) and accumulate on the top-level
/// [`HirFunction::outlined`] list.
pub fn print_function_with_outlined(func: &HirFunction) -> String {
    let mut output = vec![print_function(func)];
    for outlined in &func.outlined {
        let id = outlined.id.as_deref().unwrap_or("<<anonymous>>");
        output.push(format!("\nfunction {id}:\n{}", print_hir(&outlined.body, 0)));
    }
    output.join("\n")
}

/// Print a single function definition with its signature, directives, and body
/// (`printFunction`).
pub fn print_function(func: &HirFunction) -> String {
    let mut output: Vec<String> = Vec::new();

    let mut definition = String::new();
    match &func.id {
        Some(id) => definition.push_str(id),
        None => definition.push_str("<<anonymous>>"),
    }
    if let Some(name_hint) = &func.name_hint {
        definition.push(' ');
        definition.push_str(name_hint);
    }
    if !func.params.is_empty() {
        definition.push('(');
        let params: Vec<String> = func
            .params
            .iter()
            .map(|param| match param {
                FunctionParam::Place(place) => print_place(place),
                FunctionParam::Spread(spread) => format!("...{}", print_place(&spread.place)),
            })
            .collect();
        definition.push_str(&params.join(", "));
        definition.push(')');
    } else {
        definition.push_str("()");
    }
    definition.push_str(&format!(": {}", print_place(&func.returns)));
    output.push(definition);

    output.extend(func.directives.iter().cloned());
    output.push(print_hir(&func.body, 0));

    output.join("\n")
}

/// Print the basic blocks of `ir`, each line prefixed with `indent` spaces
/// (`printHIR`). `PrintHIR.ts` defaults `indent` to `0`.
pub fn print_hir(ir: &Hir, indent: usize) -> String {
    let indent_str = " ".repeat(indent);
    let mut output: Vec<String> = Vec::new();

    for block in ir.blocks() {
        output.push(format!("bb{} ({}):", block.id.as_u32(), block.kind.as_str()));

        if !block.preds.is_empty() {
            let mut preds = vec!["predecessor blocks:".to_string()];
            for pred in &block.preds {
                preds.push(format!("bb{}", pred.as_u32()));
            }
            output.push(format!("  {}", preds.join(" ")));
        }

        for phi in &block.phis {
            output.push(format!("  {}", print_phi(phi)));
        }

        for instr in &block.instructions {
            output.push(format!("  {}", print_instruction(instr)));
        }

        for line in print_terminal(&block.terminal) {
            output.push(format!("  {line}"));
        }
    }

    output
        .iter()
        .map(|line| format!("{indent_str}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Print a single instruction (`printInstruction`): `[id] lvalue = value`, or
/// `[id] value` when the lvalue is omitted. Stage-1 instructions always carry an
/// lvalue place, matching the TS model where `instr.lvalue !== null`.
pub fn print_instruction(instr: &Instruction) -> String {
    let id = format!("[{}]", instr.id.as_u32());
    let mut value = print_instruction_value(&instr.value);
    if let Some(effects) = &instr.effects {
        let rendered: Vec<String> = effects.iter().map(print_aliasing_effect).collect();
        value += &format!("\n    {}", rendered.join("\n    "));
    }
    format!("{id} {} = {value}", print_place(&instr.lvalue))
}

/// Print a phi node (`printPhi`): `place type: phi(bb0: p0, bb1: p1)`.
pub fn print_phi(phi: &super::model::Phi) -> String {
    let mut items = String::new();
    items.push_str(&print_place(&phi.place));
    items.push_str(&print_mutable_range(&phi.place.identifier));
    items.push_str(&print_type(&phi.place.identifier.type_));
    items.push_str(": phi(");
    let operands: Vec<String> = phi
        .operands
        .iter()
        .map(|(block_id, place)| format!("bb{}: {}", block_id.as_u32(), print_place(place)))
        .collect();
    items.push_str(&operands.join(", "));
    items.push(')');
    items
}

/// Print a terminal (`printTerminal`). Most terminals render to a single line;
/// `switch` renders to multiple lines, so this always returns a `Vec`.
pub fn print_terminal(terminal: &Terminal) -> Vec<String> {
    match terminal {
        Terminal::If {
            test,
            consequent,
            alternate,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] If ({}) then:bb{} else:bb{} fallthrough=bb{}",
            id.as_u32(),
            print_place(test),
            consequent.as_u32(),
            alternate.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Branch {
            test,
            consequent,
            alternate,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] Branch ({}) then:bb{} else:bb{} fallthrough:bb{}",
            id.as_u32(),
            print_place(test),
            consequent.as_u32(),
            alternate.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Logical {
            operator,
            test,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] Logical {} test:bb{} fallthrough=bb{}",
            id.as_u32(),
            operator.as_str(),
            test.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Ternary {
            test,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] Ternary test:bb{} fallthrough=bb{}",
            id.as_u32(),
            test.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Optional {
            optional,
            test,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] Optional (optional={}) test:bb{} fallthrough=bb{}",
            id.as_u32(),
            optional,
            test.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Throw { value, id, .. } => {
            vec![format!("[{}] Throw {}", id.as_u32(), print_place(value))]
        }
        Terminal::Return {
            return_variant,
            value,
            id,
            effects,
            ..
        } => {
            let mut line = format!(
                "[{}] Return {} {}",
                id.as_u32(),
                return_variant.as_str(),
                print_place(value),
            );
            if let Some(effects) = effects {
                let rendered: Vec<String> = effects.iter().map(print_aliasing_effect).collect();
                line += &format!("\n    {}", rendered.join("\n    "));
            }
            vec![line]
        }
        Terminal::Goto {
            block, variant, id, ..
        } => {
            let suffix = if *variant == GotoVariant::Continue {
                "(Continue)"
            } else {
                ""
            };
            vec![format!("[{}] Goto{suffix} bb{}", id.as_u32(), block.as_u32())]
        }
        Terminal::Switch {
            test,
            cases,
            fallthrough,
            id,
            ..
        } => {
            let mut output = vec![format!("[{}] Switch ({})", id.as_u32(), print_place(test))];
            for case in cases {
                match &case.test {
                    Some(case_test) => output.push(format!(
                        "  Case {}: bb{}",
                        print_place(case_test),
                        case.block.as_u32()
                    )),
                    None => output.push(format!("  Default: bb{}", case.block.as_u32())),
                }
            }
            output.push(format!("  Fallthrough: bb{}", fallthrough.as_u32()));
            output
        }
        Terminal::DoWhile {
            loop_block,
            test,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] DoWhile loop=bb{} test=bb{} fallthrough=bb{}",
            id.as_u32(),
            loop_block.as_u32(),
            test.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::While {
            test,
            loop_block,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] While test=bb{} loop=bb{} fallthrough=bb{}",
            id.as_u32(),
            test.as_u32(),
            loop_block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::For {
            init,
            test,
            update,
            loop_block,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] For init=bb{} test=bb{} loop=bb{} update=bb{} fallthrough=bb{}",
            id.as_u32(),
            init.as_u32(),
            test.as_u32(),
            loop_block.as_u32(),
            // The TS prints `bb${terminal.update}`; an absent updater stringifies
            // to `bbnull`, but stage-1 lowering always supplies one.
            update.map_or_else(|| "null".to_string(), |b| b.as_u32().to_string()),
            fallthrough.as_u32(),
        )],
        Terminal::ForOf {
            init,
            test,
            loop_block,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] ForOf init=bb{} test=bb{} loop=bb{} fallthrough=bb{}",
            id.as_u32(),
            init.as_u32(),
            test.as_u32(),
            loop_block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::ForIn {
            init,
            loop_block,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] ForIn init=bb{} loop=bb{} fallthrough=bb{}",
            id.as_u32(),
            init.as_u32(),
            loop_block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Label {
            block,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] Label block=bb{} fallthrough=bb{}",
            id.as_u32(),
            block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Sequence {
            block,
            fallthrough,
            id,
            ..
        } => vec![format!(
            "[{}] Sequence block=bb{} fallthrough=bb{}",
            id.as_u32(),
            block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Unreachable { id, .. } => vec![format!("[{}] Unreachable", id.as_u32())],
        Terminal::Unsupported { id, .. } => vec![format!("[{}] Unsupported", id.as_u32())],
        Terminal::MaybeThrow {
            continuation,
            handler,
            id,
            effects,
            ..
        } => {
            let handler_str = match handler {
                Some(handler) => format!("bb{}", handler.as_u32()),
                None => "(none)".to_string(),
            };
            let mut line = format!(
                "[{}] MaybeThrow continuation=bb{} handler={handler_str}",
                id.as_u32(),
                continuation.as_u32(),
            );
            if let Some(effects) = effects {
                let rendered: Vec<String> = effects.iter().map(print_aliasing_effect).collect();
                line += &format!("\n    {}", rendered.join("\n    "));
            }
            vec![line]
        }
        Terminal::Scope {
            fallthrough,
            block,
            scope,
            id,
            ..
        } => vec![format!(
            "[{}] Scope {} block=bb{} fallthrough=bb{}",
            id.as_u32(),
            print_reactive_scope_summary(scope),
            block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::PrunedScope {
            fallthrough,
            block,
            scope,
            id,
            ..
        } => vec![format!(
            "[{}] <pruned> Scope {} block=bb{} fallthrough=bb{}",
            id.as_u32(),
            print_reactive_scope_summary(scope),
            block.as_u32(),
            fallthrough.as_u32(),
        )],
        Terminal::Try {
            block,
            handler_binding,
            handler,
            fallthrough,
            id,
            ..
        } => {
            let binding = match handler_binding {
                Some(binding) => format!(" handlerBinding=({})", print_place(binding)),
                None => String::new(),
            };
            vec![format!(
                "[{}] Try block=bb{} handler=bb{}{binding} fallthrough=bb{}",
                id.as_u32(),
                block.as_u32(),
                handler.as_u32(),
                fallthrough.as_u32(),
            )]
        }
    }
}

fn print_hole() -> String {
    "<hole>".to_string()
}

fn print_object_property_key(key: &ObjectPropertyKey) -> String {
    match key {
        ObjectPropertyKey::Identifier { name } => name.clone(),
        ObjectPropertyKey::String { name } => format!("\"{name}\""),
        ObjectPropertyKey::Computed { name } => format!("[{}]", print_place(name)),
        ObjectPropertyKey::Number { name } => format_number(*name),
    }
}

/// Print an instruction value (`printInstructionValue`). Every
/// [`InstructionValue`] variant maps to the corresponding TS output.
pub fn print_instruction_value(instr_value: &InstructionValue) -> String {
    match instr_value {
        InstructionValue::ArrayExpression { elements, .. } => {
            let items: Vec<String> = elements
                .iter()
                .map(|element| match element {
                    ArrayElement::Place(place) => print_place(place),
                    ArrayElement::Hole => print_hole(),
                    ArrayElement::Spread(spread) => format!("...{}", print_place(&spread.place)),
                })
                .collect();
            format!("Array [{}]", items.join(", "))
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            let items: Vec<String> = properties
                .iter()
                .map(|property| match property {
                    ObjectExpressionProperty::Property(property) => format!(
                        "{}: {}",
                        print_object_property_key(&property.key),
                        print_place(&property.place)
                    ),
                    ObjectExpressionProperty::Spread(spread) => {
                        format!("...{}", print_place(&spread.place))
                    }
                })
                .collect();
            format!("Object {{ {} }}", items.join(", "))
        }
        InstructionValue::UnaryExpression { value, .. } => format!("Unary {}", print_place(value)),
        InstructionValue::BinaryExpression {
            operator,
            left,
            right,
            ..
        } => format!(
            "Binary {} {operator} {}",
            print_place(left),
            print_place(right)
        ),
        InstructionValue::NewExpression { callee, args, .. } => {
            let args: Vec<String> = args.iter().map(print_call_argument).collect();
            format!("New {}({})", print_place(callee), args.join(", "))
        }
        InstructionValue::CallExpression { callee, args, .. } => {
            let args: Vec<String> = args.iter().map(print_call_argument).collect();
            format!("Call {}({})", print_place(callee), args.join(", "))
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            ..
        } => {
            let args: Vec<String> = args.iter().map(print_call_argument).collect();
            format!(
                "MethodCall {}.{}({})",
                print_place(receiver),
                print_place(property),
                args.join(", ")
            )
        }
        InstructionValue::JsxText { value, .. } => format!("JSXText {}", json_string(value)),
        InstructionValue::Primitive { value, .. } => print_primitive(value),
        InstructionValue::TypeCastExpression { value, type_, .. } => {
            format!("TypeCast {}: {}", print_place(value), print_type(type_))
        }
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            let prop_items: Vec<String> = props
                .iter()
                .map(|attribute| match attribute {
                    JsxAttribute::Attribute { name, place } => {
                        format!("{name}={{{}}}", print_place(place))
                    }
                    JsxAttribute::Spread { argument } => format!("...{}", print_place(argument)),
                })
                .collect();
            let tag_str = match tag {
                JsxTag::Place(place) => print_place(place),
                JsxTag::Builtin(builtin) => builtin.name.clone(),
            };
            let props_str = if prop_items.is_empty() {
                String::new()
            } else {
                format!(" {}", prop_items.join(" "))
            };
            let trailing = if props_str.is_empty() { "" } else { " " };
            match children {
                Some(children) => {
                    let children: String = children
                        .iter()
                        .map(|child| format!("{{{}}}", print_place(child)))
                        .collect();
                    format!("JSX <{tag_str}{props_str}{trailing}>{children}</{tag_str}>")
                }
                None => format!("JSX <{tag_str}{props_str}{trailing}/>"),
            }
        }
        InstructionValue::JsxFragment { children, .. } => {
            let children: Vec<String> = children.iter().map(print_place).collect();
            format!("JsxFragment [{}]", children.join(", "))
        }
        InstructionValue::UnsupportedNode { node_type, .. } => {
            format!("UnsupportedNode {node_type}")
        }
        InstructionValue::LoadLocal { place, .. } => format!("LoadLocal {}", print_place(place)),
        InstructionValue::DeclareLocal { lvalue, .. } => print_declare("DeclareLocal", lvalue),
        InstructionValue::DeclareContext { kind, place, .. } => {
            format!("DeclareContext {} {}", kind.as_str(), print_place(place))
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => print_store("StoreLocal", lvalue, value),
        InstructionValue::LoadContext { place, .. } => format!("LoadContext {}", print_place(place)),
        InstructionValue::StoreContext {
            kind, place, value, ..
        } => format!(
            "StoreContext {} {} = {}",
            kind.as_str(),
            print_place(place),
            print_place(value)
        ),
        InstructionValue::Destructure { lvalue, value, .. } => format!(
            "Destructure {} {} = {}",
            lvalue_pattern_kind(lvalue),
            print_pattern_pattern(&lvalue.pattern),
            print_place(value)
        ),
        InstructionValue::PropertyLoad {
            object, property, ..
        } => format!(
            "PropertyLoad {}.{}",
            print_place(object),
            print_property_literal(property)
        ),
        InstructionValue::PropertyStore {
            object,
            property,
            value,
            ..
        } => format!(
            "PropertyStore {}.{} = {}",
            print_place(object),
            print_property_literal(property),
            print_place(value)
        ),
        InstructionValue::PropertyDelete {
            object, property, ..
        } => format!(
            "PropertyDelete {}.{}",
            print_place(object),
            print_property_literal(property)
        ),
        InstructionValue::ComputedLoad {
            object, property, ..
        } => format!(
            "ComputedLoad {}[{}]",
            print_place(object),
            print_place(property)
        ),
        InstructionValue::ComputedStore {
            object,
            property,
            value,
            ..
        } => format!(
            "ComputedStore {}[{}] = {}",
            print_place(object),
            print_place(property),
            print_place(value)
        ),
        InstructionValue::ComputedDelete {
            object, property, ..
        } => format!(
            "ComputedDelete {}[{}]",
            print_place(object),
            print_place(property)
        ),
        InstructionValue::ObjectMethod { lowered_func, .. } => {
            print_lowered_function("ObjectMethod", "", &lowered_func.func)
        }
        InstructionValue::FunctionExpression {
            name, lowered_func, ..
        } => {
            let name = name.as_deref().unwrap_or("");
            print_lowered_function("Function", name, &lowered_func.func)
        }
        InstructionValue::TaggedTemplateExpression { tag, value, .. } => {
            format!("{}`{}`", print_place(tag), value.raw)
        }
        InstructionValue::TemplateLiteral {
            subexprs, quasis, ..
        } => {
            let mut value = String::from("`");
            for (i, subexpr) in subexprs.iter().enumerate() {
                if let Some(quasi) = quasis.get(i) {
                    value.push_str(&quasi.raw);
                }
                value.push_str(&format!("${{{}}}", print_place(subexpr)));
            }
            if let Some(last) = quasis.last() {
                value.push_str(&last.raw);
            }
            value.push('`');
            value
        }
        InstructionValue::LoadGlobal { binding, .. } => print_load_global(binding),
        InstructionValue::StoreGlobal { name, value, .. } => {
            format!("StoreGlobal {name} = {}", print_place(value))
        }
        InstructionValue::RegExpLiteral { pattern, flags, .. } => {
            format!("RegExp /{pattern}/{flags}")
        }
        InstructionValue::MetaProperty { meta, property, .. } => {
            format!("MetaProperty {meta}.{property}")
        }
        InstructionValue::Await { value, .. } => format!("Await {}", print_place(value)),
        InstructionValue::GetIterator { collection, .. } => {
            format!("GetIterator collection={}", print_place(collection))
        }
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => format!(
            "IteratorNext iterator={} collection={}",
            print_place(iterator),
            print_place(collection)
        ),
        InstructionValue::NextPropertyOf { value, .. } => {
            format!("NextPropertyOf {}", print_place(value))
        }
        InstructionValue::Debugger { .. } => "Debugger".to_string(),
        InstructionValue::PostfixUpdate {
            lvalue,
            operation,
            value,
            ..
        } => format!(
            "PostfixUpdate {} = {} {operation}",
            print_place(lvalue),
            print_place(value)
        ),
        InstructionValue::PrefixUpdate {
            lvalue,
            operation,
            value,
            ..
        } => format!(
            "PrefixUpdate {} = {operation} {}",
            print_place(lvalue),
            print_place(value)
        ),
        InstructionValue::StartMemoize { deps, .. } => {
            let deps_str = match deps {
                Some(deps) => deps
                    .iter()
                    .map(|dep| print_manual_memo_dependency(dep, false))
                    .collect::<Vec<_>>()
                    .join(","),
                None => "(none)".to_string(),
            };
            format!("StartMemoize deps={deps_str}")
        }
        InstructionValue::FinishMemoize { decl, pruned, .. } => format!(
            "FinishMemoize decl={}{}",
            print_place(decl),
            if *pruned { " pruned" } else { "" }
        ),
    }
}

/// `DeclareLocal`/`DeclareContext` share the `Kind kind place` shape.
fn print_declare(label: &str, lvalue: &LValue) -> String {
    format!("{label} {} {}", lvalue.kind.as_str(), print_place(&lvalue.place))
}

/// `StoreLocal`/`StoreContext` share the `Kind kind place = value` shape.
fn print_store(label: &str, lvalue: &LValue, value: &Place) -> String {
    format!(
        "{label} {} {} = {}",
        lvalue.kind.as_str(),
        print_place(&lvalue.place),
        print_place(value)
    )
}

fn lvalue_pattern_kind(lvalue: &LValuePattern) -> &'static str {
    lvalue.kind.as_str()
}

fn print_call_argument(arg: &super::value::CallArgument) -> String {
    match arg {
        super::value::CallArgument::Place(place) => print_place(place),
        super::value::CallArgument::Spread(spread) => format!("...{}", print_place(&spread.place)),
    }
}

fn print_load_global(binding: &NonLocalBinding) -> String {
    match binding {
        NonLocalBinding::Global { name } => format!("LoadGlobal(global) {name}"),
        NonLocalBinding::ModuleLocal { name } => format!("LoadGlobal(module) {name}"),
        NonLocalBinding::ImportDefault { name, module } => {
            format!("LoadGlobal import {name} from '{module}'")
        }
        NonLocalBinding::ImportNamespace { name, module } => {
            format!("LoadGlobal import * as {name} from '{module}'")
        }
        NonLocalBinding::ImportSpecifier {
            name,
            module,
            imported,
        } => {
            if imported != name {
                format!("LoadGlobal import {{ {imported} as {name} }} from '{module}'")
            } else {
                format!("LoadGlobal import {{ {name} }} from '{module}'")
            }
        }
    }
}

/// Render a `FunctionExpression`/`ObjectMethod`: the `kind name @context[...]
/// @aliasingEffects=[...]` header followed by the nested function body indented
/// with six spaces.
fn print_lowered_function(kind: &str, name: &str, func: &HirFunction) -> String {
    let fn_str = print_function(func)
        .split('\n')
        .map(|line| format!("      {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    let context = func
        .context
        .iter()
        .map(print_place)
        .collect::<Vec<_>>()
        .join(",");
    let aliasing_effects = func
        .aliasing_effects
        .as_ref()
        .map(|effects| {
            effects
                .iter()
                .map(print_aliasing_effect)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    format!("{kind} {name} @context[{context}] @aliasingEffects=[{aliasing_effects}]\n{fn_str}")
}

fn print_property_literal(property: &PropertyLiteral) -> String {
    match property {
        PropertyLiteral::String(name) => name.clone(),
        PropertyLiteral::Number(name) => format_number(*name),
    }
}

fn print_primitive(value: &PrimitiveValue) -> String {
    match value {
        PrimitiveValue::Undefined => "<undefined>".to_string(),
        PrimitiveValue::Null => "null".to_string(),
        PrimitiveValue::Boolean(b) => b.to_string(),
        PrimitiveValue::Number(n) => format_number(*n),
        PrimitiveValue::String(s) => json_string(s),
    }
}

/// True when a mutable range is non-trivial (`isMutable`): `end > start + 1`.
fn is_mutable(range: &super::place::MutableRange) -> bool {
    range.end.as_u32() > range.start.as_u32() + 1
}

/// Print the `[start:end]` mutable range of an identifier, or the empty string
/// when the range is trivial (`printMutableRange`, non-debug branch). Stage 1
/// has no reactive scope ranges, so the identifier range is always used.
fn print_mutable_range(identifier: &Identifier) -> String {
    let range = &identifier.mutable_range;
    if is_mutable(range) {
        format!("[{}:{}]", range.start.as_u32(), range.end.as_u32())
    } else {
        String::new()
    }
}

/// Print an lvalue with its kind annotation (`printLValue`). Const/Hoisted/
/// Function kinds carry a trailing `$` in the TS source.
pub fn print_lvalue(lval: &LValue) -> String {
    use super::value::InstructionKind;
    let lvalue = print_place(&lval.place);
    match lval.kind {
        InstructionKind::Let => format!("Let {lvalue}"),
        InstructionKind::Const => format!("Const {lvalue}$"),
        InstructionKind::Reassign => format!("Reassign {lvalue}"),
        InstructionKind::Catch => format!("Catch {lvalue}"),
        InstructionKind::HoistedConst => format!("HoistedConst {lvalue}$"),
        InstructionKind::HoistedLet => format!("HoistedLet {lvalue}$"),
        InstructionKind::Function => format!("Function {lvalue}$"),
        InstructionKind::HoistedFunction => format!("HoistedFunction {lvalue}$"),
    }
}

/// Print a destructuring [`Pattern`] (`printPattern`, pattern branch).
fn print_pattern_pattern(pattern: &Pattern) -> String {
    match pattern {
        Pattern::Array(array) => {
            let items: Vec<String> = array
                .items
                .iter()
                .map(|item| match item {
                    ArrayPatternItem::Hole => "<hole>".to_string(),
                    ArrayPatternItem::Place(place) => print_place(place),
                    ArrayPatternItem::Spread(spread) => format!("...{}", print_place(&spread.place)),
                })
                .collect();
            format!("[ {} ]", items.join(", "))
        }
        Pattern::Object(object) => {
            let items: Vec<String> = object
                .properties
                .iter()
                .map(|item| match item {
                    ObjectPatternProperty::Property(property) => format!(
                        "{}: {}",
                        print_object_property_key(&property.key),
                        print_place(&property.place)
                    ),
                    ObjectPatternProperty::Spread(spread) => {
                        format!("...{}", print_place(&spread.place))
                    }
                })
                .collect();
            format!("{{ {} }}", items.join(", "))
        }
    }
}

/// Print a place (`printPlace`): `effect identifier[range]type{reactive}`. At
/// stage 1 the range and type render to the empty string.
pub fn print_place(place: &Place) -> String {
    let mut out = String::new();
    out.push_str(place.effect.as_str());
    out.push(' ');
    out.push_str(&print_identifier(&place.identifier));
    out.push_str(&print_mutable_range(&place.identifier));
    out.push_str(&print_type(&place.identifier.type_));
    if place.reactive {
        out.push_str("{reactive}");
    }
    out
}

/// Print an identifier (`printIdentifier`): `name$id` plus an optional `_@scope`.
pub fn print_identifier(id: &Identifier) -> String {
    format!(
        "{}${}{}",
        print_name(id.name.as_ref()),
        id.id.as_u32(),
        print_scope(id.scope)
    )
}

fn print_name(name: Option<&IdentifierName>) -> String {
    match name {
        None => String::new(),
        Some(IdentifierName::Named { value } | IdentifierName::Promoted { value }) => value.clone(),
    }
}

fn print_scope(scope: Option<super::ids::ScopeId>) -> String {
    match scope {
        Some(scope) => format!("_@{}", scope.as_u32()),
        None => String::new(),
    }
}

/// Print a manual-memo dependency (`printManualMemoDependency`): the root name
/// followed by its `.prop` / `?.prop` path.
pub fn print_manual_memo_dependency(val: &ManualMemoDependency, name_only: bool) -> String {
    let root_str = match &val.root {
        MemoDependencyRoot::Global { identifier_name } => identifier_name.clone(),
        MemoDependencyRoot::NamedLocal { value, .. } => {
            if name_only {
                print_name(value.identifier.name.as_ref())
            } else {
                print_identifier(&value.identifier)
            }
        }
    };
    let path: String = val
        .path
        .iter()
        .map(|entry| {
            format!(
                "{}{}",
                if entry.optional { "?." } else { "." },
                print_property_literal(&entry.property)
            )
        })
        .collect();
    format!("{root_str}{path}")
}

/// Print a type annotation (`printType`). At stage 1 every identifier is
/// [`Type::Var`] (`kind === 'Type'`), which prints as the empty string.
pub fn print_type(type_: &Type) -> String {
    match type_ {
        Type::Var { .. } => String::new(),
        Type::Object {
            shape_id: Some(shape_id),
        } => format!(":TObject<{shape_id}>"),
        Type::Function {
            shape_id: Some(shape_id),
            return_type,
            ..
        } => {
            let return_type = print_type(return_type);
            if return_type.is_empty() {
                format!(":TFunction<{shape_id}>()")
            } else {
                format!(":TFunction<{shape_id}>():  {return_type}")
            }
        }
        Type::Primitive => ":TPrimitive".to_string(),
        Type::Function { .. } => ":TFunction".to_string(),
        Type::Object { .. } => ":TObject".to_string(),
        Type::Phi { .. } => ":TPhi".to_string(),
        Type::Poly => ":TPoly".to_string(),
        Type::ObjectMethod => ":TObjectMethod".to_string(),
        Type::Property { .. } => ":TProperty".to_string(),
    }
}

/// Print a place for an aliasing effect (`printPlaceForAliasEffect`): only the
/// identifier, no effect/range/type/reactive.
fn print_place_for_alias_effect(place: &Place) -> String {
    print_identifier(&place.identifier)
}

/// Print an aliasing effect (`printAliasingEffect`), matching all kinds in
/// `PrintHIR.ts`.
pub fn print_aliasing_effect(effect: &AliasingEffect) -> String {
    use super::instruction::{ApplyArg, MutationReason};
    match effect {
        AliasingEffect::Assign { from, into } => format!(
            "Assign {} = {}",
            print_place_for_alias_effect(into),
            print_place_for_alias_effect(from)
        ),
        AliasingEffect::Alias { from, into } => format!(
            "Alias {} <- {}",
            print_place_for_alias_effect(into),
            print_place_for_alias_effect(from)
        ),
        AliasingEffect::MaybeAlias { from, into } => format!(
            "MaybeAlias {} <- {}",
            print_place_for_alias_effect(into),
            print_place_for_alias_effect(from)
        ),
        AliasingEffect::Capture { from, into } => format!(
            "Capture {} <- {}",
            print_place_for_alias_effect(into),
            print_place_for_alias_effect(from)
        ),
        AliasingEffect::ImmutableCapture { from, into } => format!(
            "ImmutableCapture {} <- {}",
            print_place_for_alias_effect(into),
            print_place_for_alias_effect(from)
        ),
        AliasingEffect::Create { into, value, .. } => {
            format!("Create {} = {}", print_place_for_alias_effect(into), value.as_str())
        }
        AliasingEffect::CreateFrom { from, into } => format!(
            "Create {} = kindOf({})",
            print_place_for_alias_effect(into),
            print_place_for_alias_effect(from)
        ),
        AliasingEffect::CreateFunction { captures, into, .. } => {
            let caps: Vec<String> = captures.iter().map(print_place_for_alias_effect).collect();
            format!(
                "Function {} = Function captures=[{}]",
                print_place_for_alias_effect(into),
                caps.join(", ")
            )
        }
        AliasingEffect::Apply {
            receiver,
            function,
            args,
            into,
            ..
        } => {
            let receiver_callee = if receiver.identifier.id == function.identifier.id {
                print_place_for_alias_effect(receiver)
            } else {
                format!(
                    "{}.{}",
                    print_place_for_alias_effect(receiver),
                    print_place_for_alias_effect(function)
                )
            };
            let args_str: Vec<String> = args
                .iter()
                .map(|arg| match arg {
                    ApplyArg::Identifier(p) => print_place_for_alias_effect(p),
                    ApplyArg::Hole => " ".to_string(),
                    ApplyArg::Spread(p) => format!("...{}", print_place_for_alias_effect(p)),
                })
                .collect();
            format!(
                "Apply {} = {}({})",
                print_place_for_alias_effect(into),
                receiver_callee,
                args_str.join(", ")
            )
        }
        AliasingEffect::Freeze { value, reason } => {
            format!("Freeze {} {}", print_place_for_alias_effect(value), reason.as_str())
        }
        AliasingEffect::Mutate { value, reason } => {
            let suffix = if matches!(reason, Some(MutationReason::AssignCurrentProperty)) {
                " (assign `.current`)"
            } else {
                ""
            };
            format!("Mutate {}{}", print_place_for_alias_effect(value), suffix)
        }
        AliasingEffect::MutateConditionally { value } => {
            format!("MutateConditionally {}", print_place_for_alias_effect(value))
        }
        AliasingEffect::MutateTransitive { value } => {
            format!("MutateTransitive {}", print_place_for_alias_effect(value))
        }
        AliasingEffect::MutateTransitiveConditionally { value } => format!(
            "MutateTransitiveConditionally {}",
            print_place_for_alias_effect(value)
        ),
        AliasingEffect::MutateFrozen { place, reason } => format!(
            "MutateFrozen {} reason={}",
            print_place_for_alias_effect(place),
            json_string(reason)
        ),
        AliasingEffect::MutateGlobal { place, reason } => format!(
            "MutateGlobal {} reason={}",
            print_place_for_alias_effect(place),
            json_string(reason)
        ),
        AliasingEffect::Impure { place, reason } => format!(
            "Impure {} reason={}",
            print_place_for_alias_effect(place),
            json_string(reason)
        ),
        AliasingEffect::Render { place } => {
            format!("Render {}", print_place_for_alias_effect(place))
        }
    }
}

/// Summary of a reactive scope as printed in a `scope`/`pruned-scope` terminal
/// (`printReactiveScopeSummary` in `PrintReactiveFunction.ts`):
/// `scope @<id> [<start>:<end>] dependencies=[…] declarations=[…] reassignments=[…]`.
/// `dependencies`/`declarations`/`reassignments` are empty until
/// `propagateScopeDependenciesHIR`.
fn print_reactive_scope_summary(scope: &ReactiveScope) -> String {
    let dependencies = scope
        .dependencies
        .iter()
        .map(print_dependency)
        .collect::<Vec<_>>()
        .join(", ");
    // `printIdentifier({...decl.identifier, scope: decl.scope})`: the declaration
    // identifier rendered with the declaring scope as its `_@N` suffix.
    let declarations = scope
        .declarations
        .iter()
        .map(|(_, decl)| {
            let mut ident = decl.identifier.clone();
            ident.scope = Some(decl.scope);
            print_identifier(&ident)
        })
        .collect::<Vec<_>>()
        .join(", ");
    let reassignments = scope
        .reassignments
        .iter()
        .map(print_identifier)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "scope @{} [{}:{}] dependencies=[{dependencies}] declarations=[{declarations}] reassignments=[{reassignments}]",
        scope.id.as_u32(),
        scope.range.start.as_u32(),
        scope.range.end.as_u32(),
    )
}

/// Render a reactive-scope dependency (`printDependency`):
/// `printIdentifier(dep.identifier) + printType(...) + path + '_' + loc`.
fn print_dependency(dep: &ReactiveScopeDependency) -> String {
    let mut out = print_identifier(&dep.identifier);
    out.push_str(&print_type(&dep.identifier.type_));
    for token in &dep.path {
        out.push_str(if token.optional { "?." } else { "." });
        out.push_str(&print_property_literal(&token.property));
    }
    out.push('_');
    out.push_str(&print_source_location(&dep.loc));
    out
}

/// Render a source location for dependency printing (`printSourceLocation`):
/// `start.line:start.column:end.line:end.column`. Dependency locs are resolved
/// to [`SourceLocation::Resolved`](super::place::SourceLocation::Resolved) by
/// `propagateScopeDependenciesHIR` (which threads the source text); an
/// unresolved byte [`Span`](super::place::SourceLocation::Span) here would only
/// arise if that resolution were skipped, so it renders the raw span as a
/// fallback.
pub fn print_source_location(loc: &super::place::SourceLocation) -> String {
    match loc {
        super::place::SourceLocation::Generated => "GeneratedSource".to_string(),
        super::place::SourceLocation::Span { start, end, .. } => format!("{start}:{end}"),
        super::place::SourceLocation::Resolved {
            start_line,
            start_column,
            end_line,
            end_column,
        } => format!("{start_line}:{start_column}:{end_line}:{end_column}"),
    }
}

/// `String(number)` semantics: integral `f64`s print without a trailing `.0`,
/// matching JS `JSON.stringify`/`String`.
fn format_number(n: f64) -> String {
    if n == n.trunc() && n.is_finite() && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        let mut s = format!("{n}");
        // Rust prints `inf`/`-inf`/`NaN`; JS uses `null` inside JSON for these,
        // but they never appear in lowered primitives, so leave the debug form.
        if s == "inf" {
            s = "Infinity".to_string();
        } else if s == "-inf" {
            s = "-Infinity".to_string();
        }
        s
    }
}

/// `JSON.stringify` of a string: double-quoted with JS escapes.
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::ids::{
        BlockId, DeclarationId, IdAllocator, IdentifierId, InstructionId, ScopeId, TypeId,
    };
    use crate::hir::instruction::Instruction;
    use crate::hir::model::{BasicBlock, BlockKind, Phi, PhiOperands, ReactFunctionType};
    use crate::hir::place::{Effect, Identifier, IdentifierName, MutableRange, SourceLocation};
    use crate::hir::terminal::{ReturnVariant, SwitchCase};
    use crate::hir::value::{
        CallArgument, FunctionExpressionType, InstructionKind, LValue, LoweredFunction,
        SpreadPattern,
    };

    /// Mirror the lowering id counters so by-hand HIR uses realistic ids.
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

        fn temp(&mut self) -> Place {
            let id = IdentifierId::new(self.identifiers.alloc());
            let type_id = TypeId::new(self.types.alloc());
            Place {
                identifier: Identifier::make_temporary(id, type_id, SourceLocation::Generated),
                effect: Effect::Unknown,
                reactive: false,
                loc: SourceLocation::Generated,
            }
        }

        fn named(&mut self, name: &str) -> Place {
            let mut place = self.temp();
            place.identifier.name = Some(IdentifierName::Named {
                value: name.to_string(),
            });
            place
        }

        fn block(&mut self) -> BlockId {
            BlockId::new(self.blocks.alloc())
        }

        fn instr_id(&mut self) -> InstructionId {
            InstructionId::new(self.instructions.alloc())
        }
    }

    fn instr(id: InstructionId, lvalue: Place, value: InstructionValue) -> Instruction {
        Instruction {
            id,
            lvalue,
            value,
            loc: SourceLocation::Generated,
            effects: None,
        }
    }

    /// `printType` across every `Type` kind, matching `PrintHIR.ts::printType`.
    /// The unknown default (`Type::Var`) must render empty so stage-1 output is
    /// unchanged; typed forms gain `:T...` suffixes only after `inferTypes`.
    #[test]
    fn print_type_covers_all_kinds() {
        // The unknown type variable prints nothing.
        assert_eq!(print_type(&Type::var(TypeId::new(0))), "");
        // Concrete primitive.
        assert_eq!(print_type(&Type::Primitive), ":TPrimitive");
        // Poly (lattice top) + ObjectMethod + Phi.
        assert_eq!(print_type(&Type::Poly), ":TPoly");
        assert_eq!(print_type(&Type::ObjectMethod), ":TObjectMethod");
        assert_eq!(
            print_type(&Type::Phi {
                operands: vec![Type::Primitive, Type::Poly]
            }),
            ":TPhi"
        );

        // Object with / without a shape id.
        assert_eq!(
            print_type(&Type::Object {
                shape_id: Some("BuiltInArray".to_string())
            }),
            ":TObject<BuiltInArray>"
        );
        assert_eq!(print_type(&Type::Object { shape_id: None }), ":TObject");

        // Function with a shape id: a non-empty return type is appended after
        // `():  `, an empty (unknown) return type is omitted.
        assert_eq!(
            print_type(&Type::Function {
                shape_id: Some("BuiltInFunction".to_string()),
                return_type: Box::new(Type::Primitive),
                is_constructor: false,
            }),
            ":TFunction<BuiltInFunction>():  :TPrimitive"
        );
        assert_eq!(
            print_type(&Type::Function {
                shape_id: Some("BuiltInFunction".to_string()),
                return_type: Box::new(Type::var(TypeId::new(0))),
                is_constructor: false,
            }),
            ":TFunction<BuiltInFunction>()"
        );
        // Bare function (no shape id) ignores the return type entirely.
        assert_eq!(
            print_type(&Type::Function {
                shape_id: None,
                return_type: Box::new(Type::Primitive),
                is_constructor: false,
            }),
            ":TFunction"
        );

        // Nested object return type (e.g. `useState`'s tuple shape).
        assert_eq!(
            print_type(&Type::Function {
                shape_id: Some("<generated_97>".to_string()),
                return_type: Box::new(Type::Object {
                    shape_id: Some("BuiltInUseState".to_string())
                }),
                is_constructor: false,
            }),
            ":TFunction<<generated_97>>():  :TObject<BuiltInUseState>"
        );
    }

    /// `function f() { return 42; }` lowers to a single block returning a
    /// primitive temporary, mirroring the `--stage HIR` dump for the same input.
    #[test]
    fn prints_tiny_return_function() {
        let mut ids = Ids::new();
        // Instruction id 0 is reserved by lowering (matching `makeInstructionId`
        // starting after the function's synthetic id), so the first printed
        // instruction is `[1]`.
        let _reserved = ids.instr_id(); // 0
        // The `returns` place is allocated first in TS lowering, matching the
        // observed `$2` id for `f(): <unknown> $2`.
        let prim = ids.temp(); // $0
        let _block_setup = ids.block(); // bb0
        let returns = ids.temp(); // $1 placeholder; header uses returns place
        let _ = returns;

        let primitive = instr(
            ids.instr_id(),
            prim.clone(),
            InstructionValue::Primitive {
                value: PrimitiveValue::Number(42.0),
                loc: SourceLocation::Generated,
            },
        );

        let entry = BlockId::new(0);
        let block = BasicBlock {
            kind: BlockKind::Block,
            id: entry,
            instructions: vec![primitive],
            terminal: Terminal::Return {
                return_variant: ReturnVariant::Explicit,
                value: prim,
                id: ids.instr_id(),
                effects: None,
                loc: SourceLocation::Generated,
            },
            preds: Default::default(),
            phis: Vec::new(),
        };

        let mut body = Hir::new(entry);
        body.push_block(block);

        let returns_place = Place {
            identifier: Identifier::make_temporary(
                IdentifierId::new(2),
                TypeId::new(2),
                SourceLocation::Generated,
            ),
            effect: Effect::Unknown,
            reactive: false,
            loc: SourceLocation::Generated,
        };

        let func = HirFunction {
            loc: SourceLocation::Generated,
            id: Some("f".to_string()),
            name_hint: None,
            fn_type: ReactFunctionType::Other,
            params: Vec::new(),
            return_type_annotation: None,
            returns: returns_place,
            context: Vec::new(),
            body,
            generator: false,
            async_: false,
            directives: Vec::new(),
            aliasing_effects: None,
            outlined: Vec::new(),
        };

        let expected = "f(): <unknown> $2\n\
bb0 (block):\n\
\u{20}\u{20}[1] <unknown> $0 = 42\n\
\u{20}\u{20}[2] Return Explicit <unknown> $0";
        assert_eq!(print_function(&func), expected);
    }

    /// A named param, directive, and `<unknown>` effect render exactly as the
    /// TS dump: header, directive line, then the block body.
    #[test]
    fn prints_header_param_and_directive() {
        let mut ids = Ids::new();
        let param = ids.named("props"); // props$0
        let returns = ids.temp(); // $1

        let entry = BlockId::new(0);
        let block = BasicBlock {
            kind: BlockKind::Block,
            id: entry,
            instructions: Vec::new(),
            terminal: Terminal::Return {
                return_variant: ReturnVariant::Void,
                value: returns.clone(),
                id: InstructionId::new(1),
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
            id: Some("App".to_string()),
            name_hint: None,
            fn_type: ReactFunctionType::Component,
            params: vec![FunctionParam::Place(param)],
            return_type_annotation: None,
            returns,
            context: Vec::new(),
            body,
            generator: false,
            async_: false,
            directives: vec!["use memo".to_string()],
            aliasing_effects: None,
            outlined: Vec::new(),
        };

        let printed = print_function(&func);
        assert_eq!(
            printed.lines().next().unwrap(),
            "App(<unknown> props$0): <unknown> $1"
        );
        assert_eq!(printed.lines().nth(1).unwrap(), "use memo");
        assert_eq!(printed.lines().nth(2).unwrap(), "bb0 (block):");
    }

    #[test]
    fn prints_load_global_forms() {
        let import_specifier = InstructionValue::LoadGlobal {
            binding: NonLocalBinding::ImportSpecifier {
                name: "useState".to_string(),
                module: "react".to_string(),
                imported: "useState".to_string(),
            },
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&import_specifier),
            "LoadGlobal import { useState } from 'react'"
        );

        let renamed = InstructionValue::LoadGlobal {
            binding: NonLocalBinding::ImportSpecifier {
                name: "local".to_string(),
                module: "mod".to_string(),
                imported: "exported".to_string(),
            },
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&renamed),
            "LoadGlobal import { exported as local } from 'mod'"
        );

        let global = InstructionValue::LoadGlobal {
            binding: NonLocalBinding::Global {
                name: "React".to_string(),
            },
            loc: SourceLocation::Generated,
        };
        assert_eq!(print_instruction_value(&global), "LoadGlobal(global) React");

        let module_local = InstructionValue::LoadGlobal {
            binding: NonLocalBinding::ModuleLocal {
                name: "helper".to_string(),
            },
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&module_local),
            "LoadGlobal(module) helper"
        );

        let default = InstructionValue::LoadGlobal {
            binding: NonLocalBinding::ImportDefault {
                name: "React".to_string(),
                module: "react".to_string(),
            },
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&default),
            "LoadGlobal import React from 'react'"
        );

        let namespace = InstructionValue::LoadGlobal {
            binding: NonLocalBinding::ImportNamespace {
                name: "React".to_string(),
                module: "react".to_string(),
            },
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&namespace),
            "LoadGlobal import * as React from 'react'"
        );
    }

    #[test]
    fn prints_store_and_call_and_binary() {
        let mut ids = Ids::new();
        let callee = ids.temp();
        let arg = ids.temp();
        let call = InstructionValue::CallExpression {
            callee: callee.clone(),
            args: vec![CallArgument::Place(arg.clone())],
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&call),
            "Call <unknown> $0(<unknown> $1)"
        );

        let store = InstructionValue::StoreLocal {
            lvalue: LValue {
                place: ids.named("onClick"),
                kind: InstructionKind::Const,
            },
            value: callee,
            type_annotation: None,
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&store),
            "StoreLocal Const <unknown> onClick$2 = <unknown> $0"
        );

        let left = ids.temp();
        let right = ids.temp();
        let binary = InstructionValue::BinaryExpression {
            operator: "+".to_string(),
            left,
            right,
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&binary),
            "Binary <unknown> $3 + <unknown> $4"
        );
    }

    #[test]
    fn prints_jsx_with_props_and_children_and_self_closing() {
        let mut ids = Ids::new();
        let on_click = ids.temp();
        let child = ids.temp();
        let with_children = InstructionValue::JsxExpression {
            tag: JsxTag::Builtin(super::super::value::BuiltinTag {
                name: "div".to_string(),
                loc: SourceLocation::Generated,
            }),
            props: vec![JsxAttribute::Attribute {
                name: "onClick".to_string(),
                place: on_click,
            }],
            children: Some(vec![child]),
            loc: SourceLocation::Generated,
            opening_loc: SourceLocation::Generated,
            closing_loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&with_children),
            "JSX <div onClick={<unknown> $0} >{<unknown> $1}</div>"
        );

        let self_closing = InstructionValue::JsxExpression {
            tag: JsxTag::Builtin(super::super::value::BuiltinTag {
                name: "span".to_string(),
                loc: SourceLocation::Generated,
            }),
            props: Vec::new(),
            children: None,
            loc: SourceLocation::Generated,
            opening_loc: SourceLocation::Generated,
            closing_loc: SourceLocation::Generated,
        };
        assert_eq!(print_instruction_value(&self_closing), "JSX <span/>");
    }

    #[test]
    fn prints_array_object_and_holes() {
        let mut ids = Ids::new();
        let a = ids.temp();
        let b = ids.temp();
        let spread = ids.temp();
        let array = InstructionValue::ArrayExpression {
            elements: vec![
                ArrayElement::Place(a.clone()),
                ArrayElement::Hole,
                ArrayElement::Place(b.clone()),
                ArrayElement::Spread(SpreadPattern {
                    place: spread.clone(),
                }),
            ],
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&array),
            "Array [<unknown> $0, <hole>, <unknown> $1, ...<unknown> $2]"
        );

        let key_place = ids.temp();
        let object = InstructionValue::ObjectExpression {
            properties: vec![
                ObjectExpressionProperty::Property(super::super::value::ObjectProperty {
                    key: ObjectPropertyKey::Identifier {
                        name: "a".to_string(),
                    },
                    property_type: super::super::value::PropertyType::Property,
                    place: a,
                }),
                ObjectExpressionProperty::Property(super::super::value::ObjectProperty {
                    key: ObjectPropertyKey::Computed { name: key_place },
                    property_type: super::super::value::PropertyType::Property,
                    place: b,
                }),
                ObjectExpressionProperty::Spread(SpreadPattern { place: spread }),
            ],
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&object),
            "Object { a: <unknown> $0, [<unknown> $3]: <unknown> $1, ...<unknown> $2 }"
        );
    }

    #[test]
    fn prints_destructure_pattern() {
        let mut ids = Ids::new();
        let count = ids.named("count");
        let set_count = ids.named("setCount");
        let value = ids.temp();
        let destructure = InstructionValue::Destructure {
            lvalue: LValuePattern {
                pattern: Pattern::Array(super::super::value::ArrayPattern {
                    items: vec![
                        ArrayPatternItem::Place(count),
                        ArrayPatternItem::Place(set_count),
                    ],
                    loc: SourceLocation::Generated,
                }),
                kind: InstructionKind::Const,
            },
            value,
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&destructure),
            "Destructure Const [ <unknown> count$0, <unknown> setCount$1 ] = <unknown> $2"
        );
    }

    #[test]
    fn prints_template_and_primitives() {
        let mut ids = Ids::new();
        let sub = ids.temp();
        let template = InstructionValue::TemplateLiteral {
            subexprs: vec![sub],
            quasis: vec![
                super::super::value::TemplateQuasi {
                    raw: "hi ".to_string(),
                    cooked: Some("hi ".to_string()),
                },
                super::super::value::TemplateQuasi {
                    raw: " world".to_string(),
                    cooked: Some(" world".to_string()),
                },
            ],
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_instruction_value(&template),
            "`hi ${<unknown> $0} world`"
        );

        assert_eq!(
            print_primitive(&PrimitiveValue::String("ok".to_string())),
            "\"ok\""
        );
        assert_eq!(print_primitive(&PrimitiveValue::Number(0.0)), "0");
        assert_eq!(print_primitive(&PrimitiveValue::Number(1.5)), "1.5");
        assert_eq!(print_primitive(&PrimitiveValue::Boolean(true)), "true");
        assert_eq!(print_primitive(&PrimitiveValue::Null), "null");
        assert_eq!(print_primitive(&PrimitiveValue::Undefined), "<undefined>");
    }

    #[test]
    fn prints_nested_function_expression() {
        let mut ids = Ids::new();
        // Instruction id 0 is reserved by lowering; the body's terminal is `[1]`.
        let _reserved = ids.instr_id(); // 0
        // Build the inner arrow: () => undefined-ish returning a temp.
        let inner_returns = ids.temp();
        let captured = ids.named("setCount");
        let entry = ids.block();
        let inner_body = {
            let mut body = Hir::new(entry);
            body.push_block(BasicBlock {
                kind: BlockKind::Block,
                id: entry,
                instructions: Vec::new(),
                terminal: Terminal::Return {
                    return_variant: ReturnVariant::Implicit,
                    value: inner_returns.clone(),
                    id: ids.instr_id(),
                    effects: None,
                    loc: SourceLocation::Generated,
                },
                preds: Default::default(),
                phis: Vec::new(),
            });
            body
        };
        let inner = HirFunction {
            loc: SourceLocation::Generated,
            id: None,
            name_hint: None,
            fn_type: ReactFunctionType::Other,
            params: Vec::new(),
            return_type_annotation: None,
            returns: inner_returns,
            context: vec![captured],
            body: inner_body,
            generator: false,
            async_: false,
            directives: Vec::new(),
            aliasing_effects: None,
            outlined: Vec::new(),
        };

        let function_expr = InstructionValue::FunctionExpression {
            name: None,
            name_hint: None,
            lowered_func: Box::new(LoweredFunction { func: inner }),
            function_type: FunctionExpressionType::ArrowFunctionExpression,
            loc: SourceLocation::Generated,
        };

        let printed = print_instruction_value(&function_expr);
        let expected = "Function  @context[<unknown> setCount$1] @aliasingEffects=[]\n\
\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}<<anonymous>>(): <unknown> $0\n\
\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}bb0 (block):\n\
\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}  [1] Return Implicit <unknown> $0";
        assert_eq!(printed, expected);
    }

    #[test]
    fn prints_terminals() {
        let mut ids = Ids::new();
        let test = ids.temp();
        let if_term = Terminal::If {
            test: test.clone(),
            consequent: BlockId::new(1),
            alternate: BlockId::new(2),
            fallthrough: BlockId::new(3),
            id: InstructionId::new(4),
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_terminal(&if_term),
            vec!["[4] If (<unknown> $0) then:bb1 else:bb2 fallthrough=bb3".to_string()]
        );

        let goto = Terminal::Goto {
            block: BlockId::new(1),
            variant: GotoVariant::Continue,
            id: InstructionId::new(5),
            loc: SourceLocation::Generated,
        };
        assert_eq!(print_terminal(&goto), vec!["[5] Goto(Continue) bb1"]);

        let switch = Terminal::Switch {
            test,
            cases: vec![
                SwitchCase {
                    test: Some(ids.temp()),
                    block: BlockId::new(1),
                },
                SwitchCase {
                    test: None,
                    block: BlockId::new(2),
                },
            ],
            fallthrough: BlockId::new(3),
            id: InstructionId::new(6),
            loc: SourceLocation::Generated,
        };
        assert_eq!(
            print_terminal(&switch),
            vec![
                "[6] Switch (<unknown> $0)".to_string(),
                "  Case <unknown> $1: bb1".to_string(),
                "  Default: bb2".to_string(),
                "  Fallthrough: bb3".to_string(),
            ]
        );
    }

    #[test]
    fn prints_phi_and_preds() {
        let mut ids = Ids::new();
        let phi_place = ids.named("x");
        let p0 = ids.temp();
        let p1 = ids.temp();
        let mut operands = PhiOperands::new();
        operands.insert(BlockId::new(0), p0);
        operands.insert(BlockId::new(2), p1);
        let phi = Phi {
            place: phi_place,
            operands,
        };
        assert_eq!(
            print_phi(&phi),
            "<unknown> x$0: phi(bb0: <unknown> $1, bb2: <unknown> $2)"
        );
    }

    #[test]
    fn prints_mutable_range_when_nontrivial() {
        let mut identifier = Identifier::make_temporary(
            IdentifierId::new(0),
            TypeId::new(0),
            SourceLocation::Generated,
        );
        // Trivial range (end <= start + 1) → empty.
        identifier.mutable_range = MutableRange::default();
        assert_eq!(print_mutable_range(&identifier), "");
        // Non-trivial range → `[start:end]`.
        identifier.mutable_range = MutableRange {
            start: InstructionId::new(1),
            end: InstructionId::new(4),
        };
        assert_eq!(print_mutable_range(&identifier), "[1:4]");
    }

    #[test]
    fn print_scope_suffix_renders_when_present() {
        let mut identifier = Identifier::make_temporary(
            IdentifierId::new(5),
            TypeId::new(0),
            SourceLocation::Generated,
        );
        identifier.scope = Some(ScopeId::new(3));
        assert_eq!(print_identifier(&identifier), "$5_@3");
    }

    #[test]
    fn declaration_id_is_used_only_for_model_not_print() {
        // Ensure the import is exercised and the placeholder builds.
        let _ = DeclarationId::new(0);
    }
}
