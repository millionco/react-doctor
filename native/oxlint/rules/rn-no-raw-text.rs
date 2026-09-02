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
        !is_test_noise_file(ctx) && is_react_native_file_active(ctx)
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
        let translation_return_function_ids = rn_raw_text_translation_return_function_ids(ctx);
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
            let receiver_name =
                react_native_jsx_element_name(&receiver_element.opening_element.name);
            if receiver_name.is_some_and(rn_raw_text_is_transparent_name)
                && rn_raw_text_nearest_function_id(receiver.id(), ctx).is_some_and(|function_id| {
                    translation_return_function_ids.contains(&function_id)
                })
            {
                continue;
            }
            if rn_raw_text_is_inside_text_boundary(
                receiver,
                ctx,
                &forwarding_kinds,
                &mut imported_forwarding_kinds,
            ) || rn_raw_text_is_expo_list_item(receiver_element, ctx)
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
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
    imported_forwarding_kinds: &mut FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> bool {
    let AstKind::JSXElement(receiver_element) = receiver.kind() else {
        return false;
    };
    let mut current_is_transparent =
        react_native_jsx_element_name(&receiver_element.opening_element.name)
            .is_some_and(rn_raw_text_is_transparent_name);
    if rn_raw_text_element_is_text_boundary(
        receiver_element,
        ctx,
        forwarding_kinds,
        imported_forwarding_kinds,
    ) {
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
        if rn_raw_text_element_is_text_boundary(
            element,
            ctx,
            forwarding_kinds,
            imported_forwarding_kinds,
        ) {
            return true;
        }
        current_is_transparent = rn_raw_text_is_transparent_name(name);
    }
    false
}

fn rn_raw_text_element_is_text_boundary<'a>(
    element: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
    imported_forwarding_kinds: &mut FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> bool {
    match react_native_jsx_receiver_kind(&element.opening_element, ctx.semantic(), forwarding_kinds)
    {
        ChildrenForwardingKind::Text => true,
        ChildrenForwardingKind::NonText => false,
        ChildrenForwardingKind::Unknown => {
            let Some(symbol_id) =
                jsx_element_symbol_id(&element.opening_element.name, ctx.semantic())
            else {
                return false;
            };
            *imported_forwarding_kinds
                .entry(symbol_id)
                .or_insert_with(|| {
                    resolve_imported_react_native_component_forwarding(
                        &element.opening_element,
                        ctx.file_path(),
                        ctx.semantic(),
                        ctx.module_record(),
                    )
                })
                == ChildrenForwardingKind::Text
        }
    }
}

fn rn_raw_text_translation_return_function_ids(
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_semantic::NodeId> {
    ctx.nodes()
        .iter()
        .filter(|function_node| {
            matches!(
                function_node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) && component_or_hook_function_name(function_node, ctx).is_some()
        })
        .filter_map(|function_node| {
            let returned_roots = rn_raw_text_returned_jsx_roots(function_node.id(), ctx);
            (!returned_roots.is_empty()
                && returned_roots
                    .iter()
                    .all(|root| rn_raw_text_translation_root_state(root, ctx) == (true, true)))
            .then_some(function_node.id())
        })
        .collect()
}

fn rn_raw_text_returned_jsx_roots<'a>(
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    let mut roots = Vec::new();
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        rn_raw_text_collect_returned_jsx_roots(expression, &mut roots);
    }
    for node in ctx.nodes().iter() {
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if rn_raw_text_nearest_function_id(node.id(), ctx) != Some(function_id) {
            continue;
        }
        if let Some(argument) = &statement.argument {
            rn_raw_text_collect_returned_jsx_roots(argument, &mut roots);
        }
    }
    roots
}

fn rn_raw_text_collect_returned_jsx_roots<'a>(
    expression: &'a Expression<'a>,
    roots: &mut Vec<&'a Expression<'a>>,
) {
    match expression.get_inner_expression() {
        expression @ (Expression::JSXElement(_) | Expression::JSXFragment(_)) => {
            roots.push(expression);
        }
        Expression::ConditionalExpression(conditional) => {
            rn_raw_text_collect_returned_jsx_roots(&conditional.consequent, roots);
            rn_raw_text_collect_returned_jsx_roots(&conditional.alternate, roots);
        }
        Expression::LogicalExpression(logical) => {
            rn_raw_text_collect_returned_jsx_roots(&logical.left, roots);
            rn_raw_text_collect_returned_jsx_roots(&logical.right, roots);
        }
        _ => {}
    }
}

fn rn_raw_text_translation_root_state(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> (bool, bool) {
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => {
            let name = react_native_jsx_element_name(&element.opening_element.name);
            if matches!(name, Some("fbt" | "fbs")) {
                return (true, true);
            }
            if rn_raw_text_is_fragment_element(&element.opening_element.name) {
                return rn_raw_text_translation_children_state(&element.children, ctx);
            }
            (false, false)
        }
        Expression::JSXFragment(fragment) => {
            rn_raw_text_translation_children_state(&fragment.children, ctx)
        }
        _ => (false, false),
    }
}

fn rn_raw_text_translation_children_state(
    children: &[oxc_ast::ast::JSXChild<'_>],
    ctx: &LintContext<'_>,
) -> (bool, bool) {
    let mut did_contain_translation = false;
    for child in children {
        let state = match child {
            oxc_ast::ast::JSXChild::Text(_) => (true, false),
            oxc_ast::ast::JSXChild::Element(element) => {
                rn_raw_text_translation_element_state(element, ctx)
            }
            oxc_ast::ast::JSXChild::Fragment(fragment) => {
                rn_raw_text_translation_children_state(&fragment.children, ctx)
            }
            oxc_ast::ast::JSXChild::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .map_or((true, false), |expression| {
                    rn_raw_text_translation_expression_state(expression, ctx)
                }),
            _ => (true, false),
        };
        if !state.0 {
            return (false, false);
        }
        did_contain_translation |= state.1;
    }
    (true, did_contain_translation)
}

fn rn_raw_text_translation_element_state(
    element: &oxc_ast::ast::JSXElement<'_>,
    ctx: &LintContext<'_>,
) -> (bool, bool) {
    let name = react_native_jsx_element_name(&element.opening_element.name);
    if matches!(name, Some("fbt" | "fbs")) {
        (true, true)
    } else if rn_raw_text_is_fragment_element(&element.opening_element.name) {
        rn_raw_text_translation_children_state(&element.children, ctx)
    } else {
        (false, false)
    }
}

fn rn_raw_text_is_fragment_element(name: &oxc_ast::ast::JSXElementName<'_>) -> bool {
    match name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => identifier.name == "Fragment",
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
            identifier.name == "Fragment"
        }
        oxc_ast::ast::JSXElementName::MemberExpression(member) => {
            member.property.name == "Fragment"
                && matches!(
                    &member.object,
                    oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier)
                        if identifier.name == "React"
                )
        }
        _ => false,
    }
}

fn rn_raw_text_translation_expression_state(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> (bool, bool) {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::TemplateLiteral(_) => (true, false),
        Expression::Identifier(identifier) if identifier.name == "undefined" => (true, false),
        Expression::ArrayExpression(array) => {
            let mut did_contain_translation = false;
            for element in &array.elements {
                let state = match element {
                    oxc_ast::ast::ArrayExpressionElement::Elision(_) => (true, false),
                    oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => {
                        return (false, false);
                    }
                    element => element
                        .as_expression()
                        .map_or((false, false), |expression| {
                            rn_raw_text_translation_expression_state(expression, ctx)
                        }),
                };
                if !state.0 {
                    return (false, false);
                }
                did_contain_translation |= state.1;
            }
            (true, did_contain_translation)
        }
        Expression::JSXElement(element) => rn_raw_text_translation_element_state(element, ctx),
        Expression::JSXFragment(fragment) => {
            rn_raw_text_translation_children_state(&fragment.children, ctx)
        }
        Expression::ConditionalExpression(conditional) => {
            let consequent = rn_raw_text_translation_expression_state(&conditional.consequent, ctx);
            let alternate = rn_raw_text_translation_expression_state(&conditional.alternate, ctx);
            (consequent.0 && alternate.0, consequent.1 || alternate.1)
        }
        Expression::LogicalExpression(logical) => {
            let right = rn_raw_text_translation_expression_state(&logical.right, ctx);
            if logical.operator == oxc_syntax::operator::LogicalOperator::And {
                return right;
            }
            let left = rn_raw_text_translation_expression_state(&logical.left, ctx);
            (left.0 && right.0, left.1 || right.1)
        }
        _ => (false, false),
    }
}

fn rn_raw_text_nearest_function_id(
    node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
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
