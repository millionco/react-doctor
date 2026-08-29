use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct RnNoRawText;

declare_oxc_lint!(
    /// Disallow raw text outside React Native text components.
    RnNoRawText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Raw text outside a Text component.",
);

impl Rule for RnNoRawText {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if ctx.nodes().iter().any(|node| {
            matches!(node.kind(), AstKind::Program(program)
                if program.directives.iter().any(|directive| directive.expression.value == "use dom"))
        }) {
            return;
        }
        let forwarding_kinds = collect_react_native_children_forwarding_components(
            ctx.semantic(),
            ctx.module_record(),
        );
        let mut imported_forwarding_kinds = FxHashMap::default();
        for node in ctx.nodes().iter() {
            if !rn_raw_text_is_static_child(node, ctx) {
                continue;
            }
            let Some(receiver) = rn_raw_text_receiver(node, ctx) else {
                continue;
            };
            let AstKind::JSXElement(receiver_element) = receiver.kind() else {
                continue;
            };
            if rn_raw_text_is_inside_text_boundary(receiver, ctx)
                || rn_raw_text_is_expo_list_item(receiver_element, ctx)
                || rn_raw_text_is_inside_platform_web_branch(node, ctx)
            {
                continue;
            }
            let receiver_kind = react_native_jsx_receiver_kind(
                &receiver_element.opening_element,
                ctx.semantic(),
                &forwarding_kinds,
            );
            let is_non_text_receiver = match receiver_kind {
                ChildrenForwardingKind::Text => false,
                ChildrenForwardingKind::NonText => true,
                ChildrenForwardingKind::Unknown => {
                    let Some(symbol_id) = jsx_element_symbol_id(
                        &receiver_element.opening_element.name,
                        ctx.semantic(),
                    ) else {
                        continue;
                    };
                    *imported_forwarding_kinds
                        .entry(symbol_id)
                        .or_insert_with(|| {
                            resolve_imported_react_native_component_forwarding(
                                &receiver_element.opening_element,
                                ctx.file_path(),
                                ctx.semantic(),
                                ctx.module_record(),
                            )
                        })
                        == ChildrenForwardingKind::NonText
                }
            };
            if !is_non_text_receiver {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "Your users hit a crash when raw {} renders outside a <Text> component on React Native.",
                    rn_raw_text_description(node)
                ))
                .with_label(node.span()),
            );
        }
    }
}

fn rn_raw_text_is_static_child(node: &crate::AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    match node.kind() {
        AstKind::JSXText(text) => !text.value.trim().is_empty(),
        AstKind::JSXExpressionContainer(container) => {
            if !matches!(
                ctx.nodes().parent_node(node.id()).kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            ) {
                return false;
            }
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            matches!(
                expression,
                Expression::StringLiteral(_)
                    | Expression::NumericLiteral(_)
                    | Expression::TemplateLiteral(_)
            )
        }
        _ => false,
    }
}

fn rn_raw_text_is_inside_platform_web_branch<'a>(
    node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                let Some(is_equality) = rn_raw_text_platform_web_test(&statement.test) else {
                    child_span = ancestor.span();
                    continue;
                };
                if (is_equality && statement.consequent.span() == child_span)
                    || (!is_equality
                        && statement
                            .alternate
                            .as_ref()
                            .is_some_and(|alternate| alternate.span() == child_span))
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let Some(is_equality) = rn_raw_text_platform_web_test(&expression.test) else {
                    child_span = ancestor.span();
                    continue;
                };
                if (is_equality && expression.consequent.span() == child_span)
                    || (!is_equality && expression.alternate.span() == child_span)
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child_span => {
                let Some(is_equality) = rn_raw_text_platform_web_test(&expression.left) else {
                    child_span = ancestor.span();
                    continue;
                };
                if (is_equality
                    && expression.operator == oxc_syntax::operator::LogicalOperator::And)
                    || (!is_equality
                        && expression.operator == oxc_syntax::operator::LogicalOperator::Or)
                {
                    return true;
                }
            }
            AstKind::SwitchCase(case) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                if case
                    .test
                    .as_ref()
                    .is_some_and(|test| rn_raw_text_is_web_string(test))
                    && case
                        .test
                        .as_ref()
                        .is_none_or(|test| test.span() != child_span)
                    && matches!(parent.kind(), AstKind::SwitchStatement(statement)
                        if rn_raw_text_is_platform_member(&statement.discriminant, "OS"))
                {
                    return true;
                }
            }
            AstKind::ObjectProperty(property) if property.value.span() == child_span => {
                if rn_raw_text_is_web_property(property) {
                    let object_node = ctx.nodes().parent_node(ancestor.id());
                    let call_node = ctx.nodes().parent_node(object_node.id());
                    if matches!(object_node.kind(), AstKind::ObjectExpression(_))
                        && matches!(call_node.kind(), AstKind::CallExpression(call)
                            if call.arguments.first().is_some_and(|argument| argument.span() == object_node.span())
                                && rn_raw_text_is_platform_member(&call.callee, "select"))
                    {
                        return true;
                    }
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_) => {
                return false;
            }
            _ => {}
        }
        child_span = ancestor.span();
    }
    false
}

fn rn_raw_text_platform_web_test(expression: &Expression<'_>) -> Option<bool> {
    let Expression::BinaryExpression(binary) = expression.get_inner_expression() else {
        return None;
    };
    let is_equality = match binary.operator {
        oxc_syntax::operator::BinaryOperator::StrictEquality => true,
        oxc_syntax::operator::BinaryOperator::StrictInequality => false,
        _ => return None,
    };
    ((rn_raw_text_is_platform_member(&binary.left, "OS")
        && rn_raw_text_is_web_string(&binary.right))
        || (rn_raw_text_is_web_string(&binary.left)
            && rn_raw_text_is_platform_member(&binary.right, "OS")))
    .then_some(is_equality)
}

fn rn_raw_text_is_platform_member(expression: &Expression<'_>, property_name: &str) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    !member.is_computed()
        && member.static_property_name() == Some(property_name)
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Platform")
}

fn rn_raw_text_is_web_string(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => literal.value == "web",
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().is_some_and(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                    == "web"
            })
        }
        _ => false,
    }
}

fn rn_raw_text_is_web_property(property: &oxc_ast::ast::ObjectProperty<'_>) -> bool {
    if property.computed {
        return matches!(&property.key,
            oxc_ast::ast::PropertyKey::StringLiteral(literal) if literal.value == "web")
            || matches!(&property.key,
                oxc_ast::ast::PropertyKey::TemplateLiteral(template)
                    if template.expressions.is_empty()
                        && template.quasis.first().is_some_and(|quasi| quasi.value.cooked.as_ref().map_or(quasi.value.raw.as_str(), |value| value.as_str()) == "web"));
    }
    property.key.static_name().as_deref() == Some("web")
}

fn rn_raw_text_receiver<'a, 'b>(
    node: &crate::AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(_) => return Some(ancestor),
            AstKind::JSXFragment(_) => return None,
            _ => {}
        }
    }
    None
}

fn rn_raw_text_is_inside_text_boundary<'a>(
    receiver: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::JSXElement(receiver_element) = receiver.kind() else {
        return false;
    };
    let mut current_is_transparent =
        react_native_jsx_element_name(&receiver_element.opening_element.name)
            .is_some_and(rn_raw_text_is_transparent_name);
    if react_native_jsx_element_name(&receiver_element.opening_element.name)
        .is_some_and(react_native_is_text_name)
    {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(receiver.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if !current_is_transparent {
            return false;
        }
        let Some(name) = react_native_jsx_element_name(&element.opening_element.name) else {
            return false;
        };
        if react_native_is_text_name(name) {
            return true;
        }
        current_is_transparent = rn_raw_text_is_transparent_name(name);
    }
    false
}

fn rn_raw_text_is_expo_list_item<'a>(
    receiver: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = jsx_element_symbol_id(&receiver.opening_element.name, ctx.semantic())
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(declaration.kind(), AstKind::ImportSpecifier(_))
        && ctx.module_record().import_entries.iter().any(|entry| {
            ctx.scoping().get_root_binding(entry.local_name.name().into()) == Some(symbol_id)
                && matches!(entry.module_request.name(), "@expo/ui" | "@expo/ui/swift-ui" | "@expo/ui/jetpack-compose")
                && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(name) if name.name() == "ListItem")
        })
}

fn rn_raw_text_is_transparent_name(name: &str) -> bool {
    matches!(name, "Fragment" | "fbt" | "fbs")
}

fn rn_raw_text_description(node: &crate::AstNode<'_>) -> String {
    match node.kind() {
        AstKind::JSXText(text) => format!("\"{}\"", rn_raw_text_preview(text.value.trim())),
        AstKind::JSXExpressionContainer(container) => match container.expression.as_expression() {
            Some(Expression::StringLiteral(literal)) => {
                format!("\"{}\"", rn_raw_text_preview(literal.value.as_str()))
            }
            Some(Expression::NumericLiteral(literal)) => {
                format!("{{{}}}", format_javascript_number(literal.value))
            }
            Some(Expression::TemplateLiteral(_)) => "template literal".to_string(),
            _ => "text content".to_string(),
        },
        _ => "text content".to_string(),
    }
}

fn rn_raw_text_preview(value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= 30 {
        return collapsed;
    }
    format!("{}...", collapsed.chars().take(30).collect::<String>())
}
