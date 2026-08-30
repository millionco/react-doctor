use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, ForStatementLeft, JSXAttribute, JSXAttributeValue, JSXExpression,
        JSXOpeningElement, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::Span;
use rustc_hash::FxHashMap;

use crate::{AstNode, context::LintContext, rule::Rule};

const STYLE_MESSAGE: &str = "You mutate the style of a DOM node this component renders, so React reverts your change on the next render; drive it with state/props or a ref instead.";
const CLASS_LIST_MESSAGE: &str = "You mutate the classList of a DOM node this component renders, so React reverts your change on the next render; drive it with state/props or a ref instead.";

#[derive(Debug, Default, Clone)]
pub struct NoMutateQueriedDomNodeInComponent;

declare_oxc_lint!(
    /// Disallow mutations of queried DOM nodes owned by a component.
    NoMutateQueriedDomNodeInComponent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow mutations of queried React-owned DOM nodes.",
);

#[derive(Clone)]
struct MutateOwnedElement {
    has_ref: bool,
    style: Option<MutateOwnedStyle>,
    dynamic_class: bool,
}

#[derive(Clone)]
struct MutateOwnedStyle {
    dynamic: bool,
    properties: Option<Vec<String>>,
}

#[derive(Default)]
struct MutateOwnedTokens {
    ids: FxHashMap<String, Vec<MutateOwnedElement>>,
    classes: FxHashMap<String, Vec<MutateOwnedElement>>,
    test_ids: FxHashMap<String, Vec<MutateOwnedElement>>,
}

#[derive(Clone)]
enum MutateQueryTarget {
    Id(String),
    Class(String),
    TestId(String),
}

impl Rule for NoMutateQueriedDomNodeInComponent {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut owned_by_component: FxHashMap<NodeId, MutateOwnedTokens> = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening) = node.kind() else {
                continue;
            };
            let Some(component) = find_render_phase_component_or_hook(node, ctx) else {
                continue;
            };
            mutate_collect_owned_element(
                opening,
                owned_by_component.entry(component.id()).or_default(),
            );
        }

        let mut targets_by_symbol: FxHashMap<SymbolId, MutateQueryTarget> = FxHashMap::default();
        let mut style_targets_by_symbol: FxHashMap<SymbolId, MutateQueryTarget> =
            FxHashMap::default();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::VariableDeclarator(declarator) => {
                    let Some(identifier) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(initializer) = declarator.init.as_ref() else {
                        continue;
                    };
                    if let Some(target) = mutate_query_target(initializer, ctx) {
                        targets_by_symbol.insert(identifier.symbol_id(), target);
                        continue;
                    }
                    let Some(member) = initializer.get_inner_expression().as_member_expression()
                    else {
                        continue;
                    };
                    if member.static_property_name() != Some("style") {
                        continue;
                    }
                    if let Some(target) =
                        mutate_receiver_target(member.object(), &targets_by_symbol, ctx)
                    {
                        style_targets_by_symbol.insert(identifier.symbol_id(), target);
                    }
                }
                AstKind::CallExpression(call) => {
                    let Some(member) = call.callee.get_inner_expression().as_member_expression()
                    else {
                        continue;
                    };
                    if member.static_property_name() != Some("forEach") {
                        continue;
                    }
                    let Some(target) = mutate_query_target(member.object(), ctx) else {
                        continue;
                    };
                    let Some(callback) = call.arguments.first().and_then(Argument::as_expression)
                    else {
                        continue;
                    };
                    let parameter = match callback.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => {
                            function.params.items.first()
                        }
                        Expression::FunctionExpression(function) => function.params.items.first(),
                        _ => None,
                    };
                    if let Some(identifier) =
                        parameter.and_then(|parameter| parameter.pattern.get_binding_identifier())
                    {
                        targets_by_symbol.insert(identifier.symbol_id(), target);
                    }
                }
                AstKind::ForOfStatement(statement) => {
                    let Some(target) = mutate_query_target(&statement.right, ctx) else {
                        continue;
                    };
                    let ForStatementLeft::VariableDeclaration(declaration) = &statement.left else {
                        continue;
                    };
                    if let Some(identifier) = declaration
                        .declarations
                        .first()
                        .and_then(|declarator| declarator.id.get_binding_identifier())
                    {
                        targets_by_symbol.insert(identifier.symbol_id(), target);
                    }
                }
                _ => {}
            }
        }

        for node in ctx.nodes().iter() {
            let Some(component) = mutate_enclosing_component(node, ctx) else {
                continue;
            };
            let Some(owned) = owned_by_component.get(&component.id()) else {
                continue;
            };
            match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    let Some(target_member) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    let property_name = target_member
                        .static_property_name()
                        .filter(|property| *property != "cssText");
                    let mut target = None;
                    if let Some(style_member) = target_member
                        .object()
                        .get_inner_expression()
                        .as_member_expression()
                        && style_member.static_property_name() == Some("style")
                    {
                        target =
                            mutate_receiver_target(style_member.object(), &targets_by_symbol, ctx);
                    } else if let Expression::Identifier(identifier) =
                        target_member.object().get_inner_expression()
                        && let Some(symbol_id) = ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                    {
                        target = style_targets_by_symbol.get(&symbol_id).cloned();
                    }
                    let Some(target) = target else {
                        continue;
                    };
                    if mutate_can_clobber_style(owned, &target, property_name)
                        && !mutate_inside_effect_cleanup(node, ctx)
                        && !mutate_assignment_restores_saved_style(
                            assignment,
                            &target,
                            property_name,
                            &targets_by_symbol,
                            ctx,
                        )
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(STYLE_MESSAGE).with_label(assignment.span),
                        );
                    }
                }
                AstKind::CallExpression(call) => {
                    let Some(method_member) =
                        call.callee.get_inner_expression().as_member_expression()
                    else {
                        continue;
                    };
                    let Some(method) = method_member.static_property_name() else {
                        continue;
                    };
                    let surface_member = method_member
                        .object()
                        .get_inner_expression()
                        .as_member_expression();
                    let surface = surface_member.and_then(|member| member.static_property_name());
                    let direct_target = surface_member.and_then(|member| {
                        mutate_receiver_target(member.object(), &targets_by_symbol, ctx)
                    });
                    if matches!(method, "add" | "remove" | "toggle" | "replace")
                        && surface == Some("classList")
                        && direct_target
                            .as_ref()
                            .is_some_and(|target| mutate_can_clobber_class(owned, target))
                        && !mutate_inside_effect_cleanup(node, ctx)
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(CLASS_LIST_MESSAGE).with_label(call.span),
                        );
                        continue;
                    }
                    if method != "setProperty" {
                        continue;
                    }
                    let style_target = if surface == Some("style") {
                        direct_target
                    } else if let Expression::Identifier(identifier) =
                        method_member.object().get_inner_expression()
                        && let Some(symbol_id) = ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                    {
                        style_targets_by_symbol.get(&symbol_id).cloned()
                    } else {
                        None
                    };
                    let property_name =
                        call.arguments.first().and_then(|argument| match argument {
                            Argument::StringLiteral(literal) => Some(literal.value.as_str()),
                            _ => None,
                        });
                    if style_target.as_ref().is_some_and(|target| {
                        mutate_can_clobber_style(owned, target, property_name)
                    }) && !mutate_inside_effect_cleanup(node, ctx)
                    {
                        ctx.diagnostic(OxcDiagnostic::warn(STYLE_MESSAGE).with_label(call.span));
                    }
                }
                _ => {}
            }
        }
    }
}

fn mutate_enclosing_component<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && component_or_hook_function_name(ancestor, ctx).is_some()
    })
}

fn mutate_collect_owned_element(opening: &JSXOpeningElement<'_>, owned: &mut MutateOwnedTokens) {
    let has_ref = get_authoritative_jsx_attribute(opening, "ref", false).is_some();
    let style =
        get_authoritative_jsx_attribute(opening, "style", false).map(mutate_style_attribute_info);
    let class_attribute = get_authoritative_jsx_attribute(opening, "className", false)
        .or_else(|| get_authoritative_jsx_attribute(opening, "class", false));
    let (class_tokens, dynamic_class) = class_attribute
        .map(mutate_class_attribute_info)
        .unwrap_or_default();
    let info = MutateOwnedElement {
        has_ref,
        style,
        dynamic_class,
    };
    if let Some(id) =
        get_authoritative_jsx_attribute(opening, "id", false).and_then(mutate_literal_jsx_string)
    {
        owned.ids.entry(id).or_default().push(info.clone());
    }
    if let Some(test_id) = get_authoritative_jsx_attribute(opening, "data-testid", false)
        .and_then(mutate_literal_jsx_string)
    {
        owned
            .test_ids
            .entry(test_id)
            .or_default()
            .push(info.clone());
    }
    for class_name in class_tokens {
        owned
            .classes
            .entry(class_name)
            .or_default()
            .push(info.clone());
    }
}

fn mutate_literal_jsx_string(attribute: &JSXAttribute<'_>) -> Option<String> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.to_string()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(literal) => Some(literal.value.to_string()),
            _ => None,
        },
        _ => None,
    }
}

fn mutate_class_attribute_info(attribute: &JSXAttribute<'_>) -> (Vec<String>, bool) {
    let Some(value) = attribute.value.as_ref() else {
        return (Vec::new(), false);
    };
    let (text, dynamic) = match value {
        JSXAttributeValue::StringLiteral(literal) => (literal.value.to_string(), false),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(literal) => (literal.value.to_string(), false),
            JSXExpression::TemplateLiteral(template) => (
                template
                    .quasis
                    .iter()
                    .map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .unwrap_or(&quasi.value.raw)
                            .as_str()
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
                !template.expressions.is_empty(),
            ),
            _ => (String::new(), true),
        },
        _ => (String::new(), false),
    };
    (
        text.split_whitespace().map(str::to_string).collect(),
        dynamic,
    )
}

fn mutate_style_attribute_info(attribute: &JSXAttribute<'_>) -> MutateOwnedStyle {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref() else {
        return MutateOwnedStyle {
            dynamic: false,
            properties: None,
        };
    };
    let Some(expression) = container.expression.as_expression() else {
        return MutateOwnedStyle {
            dynamic: false,
            properties: None,
        };
    };
    let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
        return MutateOwnedStyle {
            dynamic: true,
            properties: None,
        };
    };
    let mut dynamic = false;
    let mut properties = Some(Vec::new());
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            dynamic = true;
            properties = None;
            continue;
        };
        if property.computed {
            dynamic = true;
            properties = None;
            continue;
        }
        let Some(name) = property.key.static_name() else {
            properties = None;
            continue;
        };
        if let Some(properties) = properties.as_mut() {
            properties.push(name.to_string());
        }
        if !mutate_is_static_literal_expression(&property.value) {
            dynamic = true;
        }
    }
    MutateOwnedStyle {
        dynamic,
        properties,
    }
}

fn mutate_is_static_literal_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        _ => false,
    }
}

fn mutate_query_target(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<MutateQueryTarget> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return None;
    };
    if receiver.name != "document"
        || ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    let method = member.static_property_name()?;
    if !matches!(
        method,
        "getElementById" | "querySelector" | "querySelectorAll"
    ) {
        return None;
    }
    let Argument::StringLiteral(argument) = call.arguments.first()? else {
        return None;
    };
    let value = argument.value.as_str();
    let target = if method == "getElementById" {
        MutateQueryTarget::Id(value.to_string())
    } else if let Some(value) = value.strip_prefix('#') {
        if value.is_empty()
            || !value.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
        {
            return None;
        }
        MutateQueryTarget::Id(value.to_string())
    } else if let Some(value) = value.strip_prefix('.') {
        if value.is_empty()
            || !value.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
        {
            return None;
        }
        MutateQueryTarget::Class(value.to_string())
    } else if let Some(value) = value
        .strip_prefix("[data-testid=\"")
        .and_then(|value| value.strip_suffix("\"]"))
        .or_else(|| {
            value
                .strip_prefix("[data-testid='")
                .and_then(|value| value.strip_suffix("']"))
        })
    {
        MutateQueryTarget::TestId(value.to_string())
    } else {
        return None;
    };
    let token = match &target {
        MutateQueryTarget::Id(value)
        | MutateQueryTarget::Class(value)
        | MutateQueryTarget::TestId(value) => value,
    };
    if token == "root" || token == "__next" {
        return None;
    }
    Some(target)
}

fn mutate_receiver_target(
    expression: &Expression<'_>,
    targets_by_symbol: &FxHashMap<SymbolId, MutateQueryTarget>,
    ctx: &LintContext<'_>,
) -> Option<MutateQueryTarget> {
    if let Some(target) = mutate_query_target(expression, ctx) {
        return Some(target);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    targets_by_symbol.get(&symbol_id).cloned()
}

fn mutate_assignment_restores_saved_style(
    assignment: &oxc_ast::ast::AssignmentExpression<'_>,
    target: &MutateQueryTarget,
    property_name: Option<&str>,
    targets_by_symbol: &FxHashMap<SymbolId, MutateQueryTarget>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(property_name) = property_name else {
        return false;
    };
    let Expression::Identifier(saved_value) = assignment.right.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(saved_value.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(saved_member) = declarator
        .init
        .as_ref()
        .and_then(|initializer| initializer.get_inner_expression().as_member_expression())
    else {
        return false;
    };
    if saved_member.static_property_name() != Some(property_name) {
        return false;
    }
    let Some(style_member) = saved_member
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if style_member.static_property_name() != Some("style") {
        return false;
    }
    mutate_receiver_target(style_member.object(), targets_by_symbol, ctx)
        .is_some_and(|saved_target| mutate_targets_equal(&saved_target, target))
}

fn mutate_targets_equal(first: &MutateQueryTarget, second: &MutateQueryTarget) -> bool {
    match (first, second) {
        (MutateQueryTarget::Id(first), MutateQueryTarget::Id(second))
        | (MutateQueryTarget::Class(first), MutateQueryTarget::Class(second))
        | (MutateQueryTarget::TestId(first), MutateQueryTarget::TestId(second)) => first == second,
        _ => false,
    }
}

fn mutate_target_elements<'a>(
    owned: &'a MutateOwnedTokens,
    target: &MutateQueryTarget,
) -> &'a [MutateOwnedElement] {
    match target {
        MutateQueryTarget::Id(value) => owned.ids.get(value),
        MutateQueryTarget::Class(value) => owned.classes.get(value),
        MutateQueryTarget::TestId(value) => owned.test_ids.get(value),
    }
    .map(Vec::as_slice)
    .unwrap_or_default()
}

fn mutate_can_clobber_style(
    owned: &MutateOwnedTokens,
    target: &MutateQueryTarget,
    property_name: Option<&str>,
) -> bool {
    mutate_target_elements(owned, target).iter().any(|element| {
        let Some(style) = &element.style else {
            return false;
        };
        if element.has_ref || !style.dynamic {
            return false;
        }
        let Some(property_name) = property_name else {
            return true;
        };
        style.properties.as_ref().is_none_or(|properties| {
            let camelized = mutate_camelize_css_property(property_name);
            properties
                .iter()
                .any(|property| property == property_name || property == &camelized)
        })
    })
}

fn mutate_can_clobber_class(owned: &MutateOwnedTokens, target: &MutateQueryTarget) -> bool {
    mutate_target_elements(owned, target)
        .iter()
        .any(|element| !element.has_ref && element.dynamic_class)
}

fn mutate_camelize_css_property(property_name: &str) -> String {
    if property_name.starts_with("--") {
        return property_name.to_string();
    }
    let mut camelized = String::new();
    let mut uppercase_next = false;
    for character in property_name.chars() {
        if character == '-' {
            uppercase_next = true;
        } else if uppercase_next {
            camelized.push(character.to_ascii_uppercase());
            uppercase_next = false;
        } else {
            camelized.push(character);
        }
    }
    camelized
}

fn mutate_inside_effect_cleanup(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut cleanup_span: Option<Span> = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            let parent = ctx.nodes().parent_node(ancestor.id());
            if matches!(parent.kind(), AstKind::ReturnStatement(_)) {
                cleanup_span = Some(ancestor.span());
                continue;
            }
        }
        let AstKind::CallExpression(call) = ancestor.kind() else {
            continue;
        };
        if cleanup_span.is_some()
            && is_react_hook_call(
                call,
                &["useEffect", "useLayoutEffect", "useInsertionEffect"],
                ctx,
            )
        {
            return true;
        }
    }
    false
}
