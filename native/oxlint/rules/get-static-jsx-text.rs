fn get_static_jsx_text(element: &oxc_ast::ast::JSXElement) -> String {
    join_static_jsx_child_text(&element.children)
}

fn join_static_jsx_child_text(children: &[oxc_ast::ast::JSXChild]) -> String {
    children
        .iter()
        .map(get_static_jsx_child_text)
        .collect::<Vec<_>>()
        .join(" ")
}

fn get_static_jsx_child_text(child: &oxc_ast::ast::JSXChild) -> String {
    match child {
        oxc_ast::ast::JSXChild::Text(text) => text.value.to_string(),
        oxc_ast::ast::JSXChild::Element(element) => get_static_jsx_text(element),
        oxc_ast::ast::JSXChild::Fragment(fragment) => {
            join_static_jsx_child_text(&fragment.children)
        }
        oxc_ast::ast::JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .map(get_static_expression_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn get_static_expression_text(expression: &oxc_ast::ast::Expression) -> String {
    match expression {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => string_literal.value.to_string(),
        oxc_ast::ast::Expression::TemplateLiteral(template_literal) => template_literal
            .quasis
            .iter()
            .map(|quasi| quasi.value.raw.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        oxc_ast::ast::Expression::JSXElement(element) => get_static_jsx_text(element),
        oxc_ast::ast::Expression::JSXFragment(fragment) => {
            join_static_jsx_child_text(&fragment.children)
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => format!(
            "{} {}",
            get_static_expression_text(&conditional_expression.consequent),
            get_static_expression_text(&conditional_expression.alternate)
        ),
        oxc_ast::ast::Expression::LogicalExpression(logical_expression) => {
            get_static_expression_text(&logical_expression.right)
        }
        oxc_ast::ast::Expression::ParenthesizedExpression(parenthesized_expression) => {
            get_static_expression_text(&parenthesized_expression.expression)
        }
        _ => String::new(),
    }
}
