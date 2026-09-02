use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const RENDER_PROP_THRESHOLD: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoRenderPropChildren;

declare_oxc_lint!(
    /// Disallow components with too many render-prop slots.
    NoRenderPropChildren,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow components with too many render props.",
);

impl Rule for NoRenderPropChildren {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        let mut render_props = Vec::new();
        for attribute in &opening.attributes {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attribute.name else {
                continue;
            };
            let name = name.name.as_str();
            if !name.starts_with("render")
                || name.len() <= "render".len()
                || !name.as_bytes()["render".len()].is_ascii_uppercase()
                || name.ends_with("Props")
                || attribute.value.is_none()
                || matches!(
                    attribute.value.as_ref(),
                    Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(_))
                )
                || matches!(attribute.value.as_ref(),
                    Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container))
                        if matches!(container.expression,
                            oxc_ast::ast::JSXExpression::BooleanLiteral(_)
                            | oxc_ast::ast::JSXExpression::NullLiteral(_)
                            | oxc_ast::ast::JSXExpression::NumericLiteral(_)
                            | oxc_ast::ast::JSXExpression::StringLiteral(_)
                            | oxc_ast::ast::JSXExpression::BigIntLiteral(_)
                            | oxc_ast::ast::JSXExpression::RegExpLiteral(_)))
            {
                continue;
            }
            render_props.push((name, attribute.span()));
        }
        if render_props.len() < RENDER_PROP_THRESHOLD || render_prop_is_third_party(opening, ctx) {
            return;
        }
        let prop_list = render_props
            .iter()
            .take(RENDER_PROP_THRESHOLD)
            .map(|(name, _)| *name)
            .collect::<Vec<_>>()
            .join(", ");
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This element takes {} render props ({prop_list}…), which is hard to follow & extend. Use child components or `children` so callers don't wire up every slot.",
                render_props.len()
            ))
            .with_label(render_props[0].1),
        );
    }
}

fn render_prop_is_third_party<'a>(
    opening: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let identifier = match &opening.name {
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => identifier,
        oxc_ast::ast::JSXElementName::MemberExpression(member) => {
            let mut object = &member.object;
            loop {
                match object {
                    oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) => {
                        break identifier;
                    }
                    oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(member) => {
                        object = &member.object;
                    }
                    _ => return false,
                }
            }
        }
        _ => return false,
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(import) = ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    }) else {
        return false;
    };
    let source = import.module_request.name();
    !source.starts_with('.')
        && !source.starts_with('/')
        && !source.starts_with("@/")
        && !source.starts_with("~/")
        && !source.starts_with('#')
}
