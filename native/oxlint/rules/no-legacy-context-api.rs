use oxc_ast::{
    AstKind as LegacyContextAstKind,
    ast::{AssignmentOperator, Class, ClassElement, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoLegacyContextApi;

declare_oxc_lint!(
    /// Disallow the legacy React context API.
    NoLegacyContextApi,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow the legacy React context API.",
);

impl Rule for NoLegacyContextApi {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            LegacyContextAstKind::Class(class)
                if is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new()) =>
            {
                report_legacy_class_members(class, ctx);
            }
            LegacyContextAstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    return;
                };
                let Some(member_name) = member_expression.static_property_name() else {
                    return;
                };
                if !matches!(member_name, "childContextTypes" | "contextTypes") {
                    return;
                }
                let Expression::Identifier(component) =
                    member_expression.object().get_inner_expression()
                else {
                    return;
                };
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(component.reference_id())
                    .symbol_id()
                else {
                    return;
                };
                if !is_proven_react_component_symbol(
                    symbol_id,
                    component.span.start,
                    ctx,
                    &mut Vec::new(),
                ) && (symbol_has_write_before(symbol_id, component.span.start, ctx)
                    || !symbol_has_react_component_type_annotation(symbol_id, ctx))
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(legacy_context_message(member_name))
                        .with_label(member_expression.span()),
                );
            }
            _ => {}
        }
    }
}

fn report_legacy_class_members(class: &Class<'_>, ctx: &LintContext<'_>) {
    for element in &class.body.body {
        let (key, is_static) = match element {
            ClassElement::MethodDefinition(method) => (&method.key, method.r#static),
            ClassElement::PropertyDefinition(property) => (&property.key, property.r#static),
            _ => continue,
        };
        let Some(member_name) = property_key_identifier_name(key) else {
            continue;
        };
        let has_legacy_shape = if member_name == "getChildContext" {
            !is_static
        } else {
            is_static && matches!(member_name, "childContextTypes" | "contextTypes")
        };
        if has_legacy_shape {
            ctx.diagnostic(
                OxcDiagnostic::error(legacy_context_message(member_name)).with_label(key.span()),
            );
        }
    }
}

fn legacy_context_message(member_name: &str) -> &'static str {
    match member_name {
        "childContextTypes" => {
            "childContextTypes uses the old context API that React 19 removes, so your provider stops passing data. Switch to `createContext` with `<MyContext.Provider value={...}>` & read it with `useContext()`, moving every consumer together."
        }
        "getChildContext" => {
            "getChildContext uses the old context API that React 19 removes, so your provider stops passing data. Switch to `createContext` with `<MyContext.Provider value={...}>` & read it with `useContext()`, moving every consumer together."
        }
        _ => {
            "contextTypes uses the old context API that React 19 removes, so your component stops receiving context. Use `static contextType = MyContext` or `useContext()` in a function component, & update the provider too."
        }
    }
}
