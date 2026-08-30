use oxc_ast::{
    AstKind,
    ast::{
        ArrowFunctionBody, ClassElement, Expression, JSXAttribute, JSXAttributeItem,
        JSXAttributeValue, JSXChild, JSXElement, JSXExpression, JSXOpeningElement,
        ObjectPropertyKind, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{has_jsx_prop_ignore_case, is_interactive_element, is_interactive_role},
};

const NON_INTERACTIVE_ELEMENTS: [&str; 59] = [
    "abbr",
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "caption",
    "code",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "dir",
    "dl",
    "dt",
    "em",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "html",
    "iframe",
    "img",
    "ins",
    "label",
    "legend",
    "li",
    "main",
    "mark",
    "marquee",
    "menu",
    "meter",
    "nav",
    "ol",
    "optgroup",
    "output",
    "p",
    "pre",
    "progress",
    "ruby",
    "section",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "tfoot",
    "thead",
    "time",
    "ul",
];
const MOUSE_HANDLERS: [&str; 3] = ["onclick", "onmousedown", "onmouseup"];
const BLOCKER_METHODS: [&str; 3] = [
    "stopPropagation",
    "preventDefault",
    "stopImmediatePropagation",
];

#[derive(Debug, Default, Clone)]
pub struct NoNoninteractiveElementInteractions;

declare_oxc_lint!(
    /// Disallow actionable mouse handlers on non-interactive elements.
    NoNoninteractiveElementInteractions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow handlers on non-interactive elements.",
);

impl Rule for NoNoninteractiveElementInteractions {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut interactive_descendant_cache = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            no_noninteractive_element_interactions_check(
                node,
                opening_element,
                ctx,
                &mut interactive_descendant_cache,
            );
        }
    }
}

fn no_noninteractive_element_interactions_check<'a>(
    node: &AstNode<'a>,
    opening_element: &'a JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
    interactive_descendant_cache: &mut FxHashMap<(u32, u32), bool>,
) {
    let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
    if element_type == "label" || !NON_INTERACTIVE_ELEMENTS.contains(&element_type.as_str()) {
        return;
    }
    let has_actionable_mouse_handler = opening_element.attributes.iter().any(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return false;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attribute.name else {
            return false;
        };
        MOUSE_HANDLERS.contains(&name.name.to_ascii_lowercase().as_str())
            && !no_noninteractive_element_interactions_is_pure_blocker(attribute, node, ctx)
    });
    if !has_actionable_mouse_handler
        || no_noninteractive_element_interactions_is_hidden_from_screen_reader(
            opening_element,
            &element_type,
        )
        || no_noninteractive_element_interactions_is_content_editable(opening_element)
    {
        return;
    }
    if no_noninteractive_element_interactions_is_presentation_role(opening_element) {
        let parent = ctx.nodes().parent_node(node.id());
        if let AstKind::JSXElement(element) = parent.kind()
            && no_noninteractive_element_interactions_has_interactive_descendant(
                element,
                ctx,
                interactive_descendant_cache,
            )
        {
            return;
        }
    }
    if let Some(JSXAttributeItem::Attribute(role_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "role")
    {
        if no_noninteractive_element_interactions_role_suppresses(role_attribute, opening_element) {
            return;
        }
    }
    let message = format!(
        "Keyboard & screen reader users can't trigger this `<{element_type}>` because it isn't interactive, so use a button or link or add an interactive role."
    );
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.name.span()));
}

fn no_noninteractive_element_interactions_is_hidden_from_screen_reader(
    opening_element: &JSXOpeningElement<'_>,
    element_type: &str,
) -> bool {
    if element_type.eq_ignore_ascii_case("input") {
        let type_resolution = resolve_static_jsx_attribute(opening_element, "type", false);
        if no_noninteractive_element_interactions_resolved_static_string(&type_resolution)
            .is_some_and(|value| value.eq_ignore_ascii_case("hidden"))
        {
            return true;
        }
    }
    let hidden_resolution = resolve_static_jsx_attribute(opening_element, "hidden", false);
    if hidden_resolution.is_present {
        if hidden_resolution
            .attribute
            .is_some_and(|attribute| attribute.value.is_none())
        {
            return true;
        }
        if let Some(value) =
            no_noninteractive_element_interactions_resolved_static_string(&hidden_resolution)
        {
            return !value.is_empty();
        }
        if no_noninteractive_element_interactions_resolved_expression(&hidden_resolution)
            .is_some_and(no_noninteractive_element_interactions_is_truthy_literal)
        {
            return true;
        }
    }
    let aria_hidden_resolution =
        resolve_static_jsx_attribute(opening_element, "aria-hidden", false);
    if !aria_hidden_resolution.is_present {
        return false;
    }
    if no_noninteractive_element_interactions_resolved_static_string(&aria_hidden_resolution)
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
    {
        return true;
    }
    if aria_hidden_resolution
        .attribute
        .is_some_and(|attribute| attribute.value.is_none())
    {
        return true;
    }
    matches!(
        no_noninteractive_element_interactions_resolved_expression(&aria_hidden_resolution),
        Some(Expression::BooleanLiteral(value)) if value.value
    )
}

fn no_noninteractive_element_interactions_resolved_static_string<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a str> {
    if let Some(value) = resolution
        .attribute
        .and_then(no_noninteractive_element_interactions_direct_string_value)
    {
        return Some(value);
    }
    match resolution.expression?.get_inner_expression() {
        Expression::StringLiteral(value) => Some(value.value.as_str()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
            )
        }
        _ => None,
    }
}

fn no_noninteractive_element_interactions_resolved_expression<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a Expression<'a>> {
    if let Some(expression) = resolution.expression {
        return Some(expression.get_inner_expression());
    }
    let JSXAttributeValue::ExpressionContainer(container) = resolution.attribute?.value.as_ref()?
    else {
        return None;
    };
    Some(container.expression.as_expression()?.get_inner_expression())
}

fn no_noninteractive_element_interactions_is_truthy_literal(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::BooleanLiteral(value) => value.value,
        Expression::NumericLiteral(value) => value.value != 0.0,
        Expression::StringLiteral(value) => !value.value.is_empty(),
        _ => false,
    }
}

fn no_noninteractive_element_interactions_is_content_editable(
    opening_element: &JSXOpeningElement<'_>,
) -> bool {
    let Some(JSXAttributeItem::Attribute(attribute)) =
        has_jsx_prop_ignore_case(opening_element, "contenteditable")
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => {
            matches!(value.value.as_str(), "" | "true")
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            &container.expression,
            JSXExpression::BooleanLiteral(value) if value.value
        ),
        _ => false,
    }
}

fn no_noninteractive_element_interactions_is_presentation_role(
    opening_element: &JSXOpeningElement<'_>,
) -> bool {
    has_jsx_prop_ignore_case(opening_element, "role")
        .and_then(JSXAttributeItem::as_attribute)
        .and_then(no_noninteractive_element_interactions_direct_string_value)
        .is_some_and(|role| matches!(role, "presentation" | "none"))
}

fn no_noninteractive_element_interactions_has_interactive_descendant<'a>(
    element: &JSXElement<'a>,
    ctx: &LintContext<'a>,
    cache: &mut FxHashMap<(u32, u32), bool>,
) -> bool {
    let cache_key = (element.span.start, element.span.end);
    if let Some(result) = cache.get(&cache_key) {
        return *result;
    }
    let result = element.children.iter().any(|child| {
        let JSXChild::Element(child_element) = child else {
            return false;
        };
        let opening = &child_element.opening_element;
        let element_type = crate::utils::get_jsx_element_name(&opening.name);
        if is_interactive_element(&element_type, opening) {
            return true;
        }
        if has_jsx_prop_ignore_case(opening, "role")
            .and_then(JSXAttributeItem::as_attribute)
            .and_then(no_noninteractive_element_interactions_direct_string_value)
            .is_some_and(is_interactive_role)
        {
            return true;
        }
        no_noninteractive_element_interactions_has_interactive_descendant(child_element, ctx, cache)
    });
    cache.insert(cache_key, result);
    result
}

#[derive(Default)]
struct NoNoninteractiveElementInteractionsRoleBranches {
    string_values: Vec<String>,
    has_non_role_branch: bool,
    has_opaque_branch: bool,
}

fn no_noninteractive_element_interactions_collect_role_branches(
    expression: &Expression<'_>,
    branches: &mut NoNoninteractiveElementInteractionsRoleBranches,
) {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::StringLiteral(value) => branches.string_values.push(value.value.to_string()),
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => branches.has_non_role_branch = true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => {
            branches.has_non_role_branch = true;
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
            branches.has_non_role_branch = true;
        }
        Expression::ConditionalExpression(conditional) => {
            no_noninteractive_element_interactions_collect_role_branches(
                &conditional.consequent,
                branches,
            );
            no_noninteractive_element_interactions_collect_role_branches(
                &conditional.alternate,
                branches,
            );
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            branches.has_non_role_branch = true;
            no_noninteractive_element_interactions_collect_role_branches(&logical.right, branches);
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::Coalesce => {
            let string_count = branches.string_values.len();
            let had_non_role_branch = branches.has_non_role_branch;
            no_noninteractive_element_interactions_collect_role_branches(&logical.left, branches);
            if branches.string_values.len() == string_count
                && branches.has_non_role_branch == had_non_role_branch
            {
                branches.has_non_role_branch = true;
            }
            no_noninteractive_element_interactions_collect_role_branches(&logical.right, branches);
        }
        Expression::LogicalExpression(logical) => {
            if logical.operator == LogicalOperator::Or
                && matches!(logical.left.get_inner_expression(), Expression::StringLiteral(value) if !value.value.is_empty())
            {
                if let Expression::StringLiteral(value) = logical.left.get_inner_expression() {
                    branches.string_values.push(value.value.to_string());
                }
                return;
            }
            no_noninteractive_element_interactions_collect_role_branches(&logical.left, branches);
            no_noninteractive_element_interactions_collect_role_branches(&logical.right, branches);
        }
        _ => branches.has_opaque_branch = true,
    }
}

fn no_noninteractive_element_interactions_role_suppresses(
    role_attribute: &JSXAttribute<'_>,
    opening_element: &JSXOpeningElement<'_>,
) -> bool {
    if no_noninteractive_element_interactions_direct_string_value(role_attribute)
        .is_some_and(is_interactive_role)
    {
        return true;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = role_attribute.value.as_ref()
    else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    let mut branches = NoNoninteractiveElementInteractionsRoleBranches::default();
    no_noninteractive_element_interactions_collect_role_branches(expression, &mut branches);
    let every_string_branch_is_interactive = !branches.string_values.is_empty()
        && branches
            .string_values
            .iter()
            .all(|role| is_interactive_role(role));
    if every_string_branch_is_interactive
        && !branches.has_non_role_branch
        && !branches.has_opaque_branch
    {
        return true;
    }
    if branches.string_values.is_empty() && !branches.has_non_role_branch {
        return true;
    }
    every_string_branch_is_interactive
        && branches.has_non_role_branch
        && has_jsx_prop_ignore_case(opening_element, "tabindex").is_some()
}

fn no_noninteractive_element_interactions_direct_string_value<'a>(
    attribute: &'a JSXAttribute<'a>,
) -> Option<&'a str> {
    let Some(JSXAttributeValue::StringLiteral(value)) = attribute.value.as_ref() else {
        return None;
    };
    Some(value.value.as_str())
}

fn no_noninteractive_element_interactions_is_pure_blocker<'a>(
    attribute: &'a JSXAttribute<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref() else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    no_noninteractive_element_interactions_expression_is_pure_blocker(expression, opening_node, ctx)
}

fn no_noninteractive_element_interactions_expression_is_pure_blocker<'a>(
    expression: &'a Expression<'a>,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.get_expression().map_or_else(
            || {
                let ArrowFunctionBody::FunctionBody(body) = &function.body else {
                    return false;
                };
                no_noninteractive_element_interactions_statements_are_pure_blockers(
                    &body.statements,
                )
            },
            no_noninteractive_element_interactions_is_blocker_call,
        ),
        Expression::FunctionExpression(function) => function.body.as_ref().is_some_and(|body| {
            no_noninteractive_element_interactions_statements_are_pure_blockers(&body.statements)
        }),
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(property_name) = member.static_property_name() else {
                return false;
            };
            if matches!(
                member.object().get_inner_expression(),
                Expression::ThisExpression(_)
            ) {
                for ancestor in ctx.nodes().ancestors(opening_node.id()) {
                    match ancestor.kind() {
                        AstKind::Class(class) => {
                            return class.body.body.iter().any(|class_element| {
                                match class_element {
                                    ClassElement::MethodDefinition(method)
                                        if method.key.static_name().as_deref()
                                            == Some(property_name) =>
                                    {
                                        method.value.body.as_ref().is_some_and(|body| {
                                            no_noninteractive_element_interactions_statements_are_pure_blockers(
                                                &body.statements,
                                            )
                                        })
                                    }
                                    ClassElement::PropertyDefinition(property)
                                        if property.key.static_name().as_deref()
                                            == Some(property_name) =>
                                    {
                                        property.value.as_ref().is_some_and(|value| {
                                            no_noninteractive_element_interactions_expression_is_pure_blocker(
                                                value,
                                                opening_node,
                                                ctx,
                                            )
                                        })
                                    }
                                    _ => false,
                                }
                            });
                        }
                        AstKind::ObjectExpression(object)
                            if no_noninteractive_element_interactions_object_has_pure_blocker(
                                object,
                                property_name,
                                opening_node,
                                ctx,
                            ) =>
                        {
                            return true;
                        }
                        _ => {}
                    }
                }
                return false;
            }
            let Expression::Identifier(object_identifier) = member.object().get_inner_expression()
            else {
                return false;
            };
            let Some(Expression::ObjectExpression(object)) =
                no_noninteractive_element_interactions_identifier_initializer(
                    object_identifier,
                    ctx,
                )
                .map(Expression::get_inner_expression)
            else {
                return false;
            };
            no_noninteractive_element_interactions_object_has_pure_blocker(
                object,
                property_name,
                opening_node,
                ctx,
            )
        }
    }
}

fn no_noninteractive_element_interactions_object_has_pure_blocker<'a>(
    object: &'a oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
    opening_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        property.key.static_name().as_deref() == Some(property_name)
            && no_noninteractive_element_interactions_expression_is_pure_blocker(
                &property.value,
                opening_node,
                ctx,
            )
    })
}

fn no_noninteractive_element_interactions_identifier_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn no_noninteractive_element_interactions_statements_are_pure_blockers(
    statements: &[Statement<'_>],
) -> bool {
    !statements.is_empty()
        && statements.iter().all(|statement| {
            let Statement::ExpressionStatement(statement) = statement else {
                return false;
            };
            no_noninteractive_element_interactions_is_blocker_call(&statement.expression)
        })
}

fn no_noninteractive_element_interactions_is_blocker_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    call.callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member| {
            !member.is_computed()
                && member
                    .static_property_name()
                    .is_some_and(|method| BLOCKER_METHODS.contains(&method))
        })
}
