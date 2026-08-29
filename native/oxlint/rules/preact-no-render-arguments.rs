use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Your users hit `undefined` props under `preact/compat` when you read `render(props, state)` from arguments, since compat uses React's parameterless render, so read from `this.props` & `this.state` instead.";

#[derive(Debug, Default, Clone)]
pub struct PreactNoRenderArguments;

declare_oxc_lint!(
    /// Disallow positional arguments on Preact class render methods.
    PreactNoRenderArguments,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow positional arguments on Preact render methods.",
);

impl Rule for PreactNoRenderArguments {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::MethodDefinition(method) = node.kind() else {
            return;
        };
        if method.r#static
            || method.kind != oxc_ast::ast::MethodDefinitionKind::Method
            || !matches!(&method.key,
                oxc_ast::ast::PropertyKey::StaticIdentifier(identifier)
                    if identifier.name == "render")
                && !matches!(&method.key,
                    oxc_ast::ast::PropertyKey::Identifier(identifier)
                        if identifier.name == "render")
            || !preact_render_method_has_component_owner(node, ctx)
        {
            return;
        }
        let parameters = &method.value.params.items;
        let parameter = if matches!(parameters.first().map(|parameter| &parameter.pattern),
            Some(oxc_ast::ast::BindingPattern::BindingIdentifier(identifier))
                if identifier.name == "this")
        {
            parameters.get(1)
        } else {
            parameters.first()
        };
        let Some(parameter) = parameter else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(parameter.span()));
    }
}

fn preact_render_method_has_component_owner(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let class_node = ctx
        .nodes()
        .ancestors(node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)));
    let Some(class_node) = class_node else {
        return false;
    };
    if is_react_es6_component(class_node) {
        return true;
    }
    let AstKind::Class(class) = class_node.kind() else {
        return false;
    };
    let Some(heritage) = &class.heritage else {
        return false;
    };
    match &heritage.expression {
        Expression::Identifier(_) => false,
        Expression::StaticMemberExpression(member) => {
            matches!(member.object.get_inner_expression(),
                Expression::Identifier(identifier) if identifier.name == "Preact")
                && matches!(member.property.name.as_str(), "Component" | "PureComponent")
        }
        Expression::ComputedMemberExpression(member) => {
            matches!(member.object.get_inner_expression(),
                Expression::Identifier(identifier) if identifier.name == "Preact")
                && matches!(&member.expression,
                    Expression::Identifier(identifier)
                        if matches!(identifier.name.as_str(), "Component" | "PureComponent"))
        }
        _ => false,
    }
}
