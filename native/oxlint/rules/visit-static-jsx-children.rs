fn visit_static_jsx_children<'a, OnElement, OnOpaqueExpression>(
    children: &'a [oxc_ast::ast::JSXChild<'a>],
    on_element: &mut OnElement,
    on_opaque_expression: &mut OnOpaqueExpression,
) where
    OnElement: FnMut(&'a oxc_ast::ast::JSXElement<'a>) -> bool,
    OnOpaqueExpression: FnMut(),
{
    use oxc_ast::ast::JSXChild;

    for child in children {
        match child {
            JSXChild::Element(element) => {
                if on_element(element) {
                    visit_static_jsx_children(&element.children, on_element, on_opaque_expression);
                }
            }
            JSXChild::Fragment(fragment) => {
                visit_static_jsx_children(&fragment.children, on_element, on_opaque_expression)
            }
            JSXChild::ExpressionContainer(container) => {
                if let Some(expression) = container.expression.as_expression() {
                    visit_static_jsx_expression(expression, on_element, on_opaque_expression);
                }
            }
            JSXChild::Text(_) | JSXChild::Spread(_) => {}
        }
    }
}

fn visit_static_jsx_expression<'a, OnElement, OnOpaqueExpression>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    on_element: &mut OnElement,
    on_opaque_expression: &mut OnOpaqueExpression,
) where
    OnElement: FnMut(&'a oxc_ast::ast::JSXElement<'a>) -> bool,
    OnOpaqueExpression: FnMut(),
{
    use oxc_ast::ast::{ArrayExpressionElement, Expression};
    use oxc_syntax::operator::LogicalOperator;

    let expression = expression.get_inner_expression();
    match expression {
        Expression::JSXElement(element) => {
            if on_element(element) {
                visit_static_jsx_children(&element.children, on_element, on_opaque_expression);
            }
        }
        Expression::JSXFragment(fragment) => {
            visit_static_jsx_children(&fragment.children, on_element, on_opaque_expression)
        }
        Expression::ConditionalExpression(conditional) => {
            visit_static_jsx_expression(&conditional.consequent, on_element, on_opaque_expression);
            visit_static_jsx_expression(&conditional.alternate, on_element, on_opaque_expression);
        }
        Expression::LogicalExpression(logical) => {
            if logical.operator != LogicalOperator::And {
                visit_static_jsx_expression(&logical.left, on_element, on_opaque_expression);
            }
            visit_static_jsx_expression(&logical.right, on_element, on_opaque_expression);
        }
        Expression::ArrayExpression(array) => {
            for element in &array.elements {
                if let Some(expression) = ArrayExpressionElement::as_expression(element) {
                    visit_static_jsx_expression(expression, on_element, on_opaque_expression);
                } else if matches!(element, ArrayExpressionElement::SpreadElement(_)) {
                    on_opaque_expression();
                }
            }
        }
        Expression::Identifier(identifier) if identifier.name == "undefined" => {}
        Expression::TemplateLiteral(_) => {}
        expression if expression.is_literal() => {}
        _ => on_opaque_expression(),
    }
}
