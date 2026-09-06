use crate::{AstNode, context::LintContext, rule::Rule};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

#[derive(Debug, Default, Clone)]
pub struct MotionDragAxisConstraintMismatch;
declare_oxc_lint!(
    /// Validates Motion drag-axis constraints.
    MotionDragAxisConstraintMismatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Motion drag-axis constraints."
);
impl Rule for MotionDragAxisConstraintMismatch {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(open) = node.kind() else {
            return;
        };
        if open
            .attributes
            .iter()
            .any(|a| matches!(a, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)))
            || !is_proven_motion_jsx_element(&open.name, ctx)
        {
            return;
        }
        let Some(drag) = motion_drag_attribute(open, "drag") else {
            return;
        };
        let Some(axis) = motion_drag_string(drag) else {
            return;
        };
        if axis != "x" && axis != "y" {
            return;
        }
        let Some(constraints) = motion_drag_attribute(open, "dragConstraints") else {
            return;
        };
        let Some(object) = motion_drag_object(constraints, ctx) else {
            return;
        };
        let mut values = rustc_hash::FxHashMap::default();
        let mut spans = rustc_hash::FxHashMap::default();
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return;
            };
            if property.computed
                || property.method
                || property.kind != oxc_ast::ast::PropertyKind::Init
            {
                return;
            }
            let Some(name) = property.key.static_name() else {
                return;
            };
            values.insert(name.to_string(), motion_drag_number(&property.value));
            spans.insert(name.to_string(), property.span);
        }
        let (start, end, cross_start, cross_end) = if axis == "x" {
            ("left", "right", "top", "bottom")
        } else {
            ("top", "bottom", "left", "right")
        };
        if !values.contains_key(start)
            && !values.contains_key(end)
            && (values.contains_key(cross_start) || values.contains_key(cross_end))
        {
            ctx.diagnostic(OxcDiagnostic::warn(format!("This {axis}-axis drag only has {cross_start}/{cross_end} constraints, so Motion cannot bound movement on its selected axis. Add {start} or {end}.")).with_label(constraints.span));
            return;
        }
        if let (Some(Some(a)), Some(Some(b))) = (values.get(start), values.get(end))
            && a > b
        {
            ctx.diagnostic(OxcDiagnostic::warn(format!("This {start} bound is greater than {end}, so the {axis}-axis constraint interval is inverted. Keep {start} less than or equal to {end}.")).with_label(spans[end]));
        }
    }
}
fn motion_drag_string<'a>(attribute: &'a oxc_ast::ast::JSXAttribute<'a>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(v) => Some(v.value.as_str()),
        JSXAttributeValue::ExpressionContainer(c) => {
            match c.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(v) => Some(v.value.as_str()),
                Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                    template.quasis.first().map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                    })
                }
                _ => None,
            }
        }
        _ => None,
    }
}
fn motion_drag_object<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let JSXAttributeValue::ExpressionContainer(c) = attribute.value.as_ref()? else {
        return None;
    };
    let mut e = c.expression.as_expression()?.get_inner_expression();
    if let Expression::Identifier(id) = e {
        let sid = ctx.scoping().get_reference(id.reference_id()).symbol_id()?;
        if ctx
            .scoping()
            .get_resolved_references(sid)
            .any(|r| r.is_write())
        {
            return None;
        }
        let AstKind::VariableDeclarator(d) = ctx.symbol_declaration(sid).kind() else {
            return None;
        };
        if d.id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != sid)
        {
            return None;
        }
        e = d.init.as_ref()?.get_inner_expression();
    }
    match e {
        Expression::ObjectExpression(o) => Some(o),
        _ => None,
    }
}
fn motion_drag_number(e: &Expression<'_>) -> Option<f64> {
    match e.get_inner_expression() {
        Expression::NumericLiteral(n) => Some(n.value),
        Expression::UnaryExpression(u)
            if matches!(
                u.operator,
                oxc_syntax::operator::UnaryOperator::UnaryNegation
                    | oxc_syntax::operator::UnaryOperator::UnaryPlus
            ) =>
        {
            match u.argument.get_inner_expression() {
                Expression::NumericLiteral(n) => Some(
                    if u.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation {
                        -n.value
                    } else {
                        n.value
                    },
                ),
                _ => None,
            }
        }
        _ => None,
    }
}
fn motion_drag_attribute<'a, 'b>(
    opening: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening.attributes.iter().rev().find_map(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier) if identifier.name == name)
            .then_some(attribute.as_ref())
    })
}
