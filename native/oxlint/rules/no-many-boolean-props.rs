use oxc_ast::ast::{BindingPattern, Expression, FunctionType, JSXAttributeName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const BOOLEAN_PROP_THRESHOLD: usize = 4;
const BOOLEAN_PROP_PREFIXES: [&str; 9] = [
    "is", "has", "should", "can", "show", "hide", "enable", "disable", "with",
];
const IMPERATIVE_CALLBACK_PREFIXES: [&str; 4] = ["show", "hide", "enable", "disable"];

#[derive(Debug, Default, Clone)]
pub struct NoManyBooleanProps;

declare_oxc_lint!(
    /// Disallow components with many boolean-like props.
    NoManyBooleanProps,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow components with many boolean-like props.",
);

impl Rule for NoManyBooleanProps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration =>
                {
                    let Some(identifier) = &function.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    check_component(
                        node,
                        function.params.items.first(),
                        identifier.name.as_str(),
                        identifier.span,
                        ctx,
                    );
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let Some(function_node_id) = unwrap_inline_react_hoc_function(initializer, ctx)
                    else {
                        continue;
                    };
                    let function_node = ctx.nodes().get_node(function_node_id);
                    let binding_span = oxc_span::Span::new(
                        declarator.id.span().start,
                        declarator
                            .type_annotation
                            .as_ref()
                            .map_or(declarator.id.span().end, |annotation| annotation.span.end),
                    );
                    let first_parameter = match function_node.kind() {
                        AstKind::Function(function) => function.params.items.first(),
                        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
                        _ => None,
                    };
                    check_component(
                        function_node,
                        first_parameter,
                        identifier.name.as_str(),
                        binding_span,
                        ctx,
                    );
                }
                _ => {}
            }
        }
    }
}

fn check_component<'a>(
    function_node: &AstNode<'a>,
    first_parameter: Option<&oxc_ast::ast::FormalParameter<'a>>,
    component_name: &str,
    report_span: oxc_span::Span,
    ctx: &LintContext<'a>,
) {
    let Some(first_parameter) = first_parameter else {
        return;
    };
    let parameter = unwrap_parameter_pattern(&first_parameter.pattern);
    if !function_contains_react_render_output(function_node, ctx) {
        return;
    }
    let boolean_prop_names = match parameter {
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .filter_map(|property| {
                let property_name = property_key_identifier_name(&property.key)?;
                if !is_boolean_prefixed_prop_name(property_name) {
                    return None;
                }
                let binding = property.value.get_binding_identifier()?;
                (!symbol_is_used_as_callback(binding.symbol_id(), binding.name.as_str(), ctx))
                    .then_some(property_name)
            })
            .collect::<Vec<_>>(),
        BindingPattern::BindingIdentifier(identifier) => {
            collect_boolean_member_props(function_node, identifier.name.as_str(), ctx)
        }
        _ => return,
    };
    if boolean_prop_names.len() < BOOLEAN_PROP_THRESHOLD {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Component \"{component_name}\" takes {} on/off props ({}…), which is hard to combine & test. Split it into smaller components or named variants.",
            boolean_prop_names.len(),
            boolean_prop_names.iter().take(3).copied().collect::<Vec<_>>().join(", "),
        ))
        .with_label(report_span),
    );
}

fn unwrap_parameter_pattern<'a>(pattern: &'a BindingPattern<'a>) -> &'a BindingPattern<'a> {
    match pattern {
        BindingPattern::AssignmentPattern(assignment) => unwrap_parameter_pattern(&assignment.left),
        _ => pattern,
    }
}

fn is_boolean_prefixed_prop_name(name: &str) -> bool {
    BOOLEAN_PROP_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
    })
}

fn is_imperative_callback_name(name: &str) -> bool {
    IMPERATIVE_CALLBACK_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
    })
}

fn symbol_is_used_as_callback(
    symbol_id: oxc_semantic::SymbolId,
    binding_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let node = ctx.nodes().get_node(reference.node_id());
            node_is_callback_use(node, binding_name, ctx)
        })
}

fn node_is_callback_use(node: &AstNode<'_>, name: &str, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    match parent.kind() {
        AstKind::CallExpression(call) => {
            call.callee.span() == node.span()
                || is_imperative_callback_name(name)
                    && call
                        .arguments
                        .iter()
                        .any(|argument| argument.span() == node.span())
        }
        AstKind::JSXExpressionContainer(_) => jsx_expression_is_event_handler(parent, ctx),
        _ => false,
    }
}

fn collect_boolean_member_props<'a>(
    function_node: &AstNode<'a>,
    parameter_name: &str,
    ctx: &LintContext<'a>,
) -> Vec<&'a str> {
    let mut names = Vec::new();
    for node in ctx.nodes().iter() {
        if !function_node.span().contains_inclusive(node.span()) {
            continue;
        }
        let AstKind::StaticMemberExpression(member) = node.kind() else {
            continue;
        };
        let Expression::Identifier(object) = member.object.get_inner_expression() else {
            continue;
        };
        let name = member.property.name.as_str();
        if object.name != parameter_name
            || !is_boolean_prefixed_prop_name(name)
            || node_is_callback_use(node, name, ctx)
            || names.contains(&name)
        {
            continue;
        }
        names.push(name);
    }
    names
}

fn jsx_expression_is_event_handler(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let attribute = ctx.nodes().parent_node(node.id());
    let AstKind::JSXAttribute(attribute) = attribute.kind() else {
        return false;
    };
    matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
        if identifier.name.strip_prefix("on").and_then(|suffix| suffix.as_bytes().first()).is_some_and(u8::is_ascii_uppercase))
}

fn unwrap_inline_react_hoc_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
    ) {
        return ctx.nodes().iter().find_map(|node| {
            (node.span() == expression.span()
                && matches!(
                    node.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ))
            .then_some(node.id())
        });
    }
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let callee_name = call
        .callee
        .as_member_expression()
        .and_then(|member| member.static_property_name())
        .or_else(|| match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        })?;
    if !matches!(callee_name, "memo" | "forwardRef") {
        return None;
    }
    let argument = call.arguments.first()?.as_expression()?;
    unwrap_inline_react_hoc_function(argument, ctx)
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
