use oxc_ast::{AstKind as NoThisAstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_es5_component};

const MESSAGE: &str = "This value is `undefined` because function components have no `this`.";

#[derive(Debug, Default, Clone)]
pub struct NoThisInSfc;

declare_oxc_lint!(
    /// Disallow this member reads inside function components.
    NoThisInSfc,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow this in function components.",
);

impl Rule for NoThisInSfc {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let custom_class_factories = no_this_in_sfc_custom_class_factories(ctx);
        let curated_behavior = should_use_curated_port_behavior(ctx);
        for node in ctx.nodes().iter() {
            let NoThisAstKind::ThisExpression(this_expression) = node.kind() else {
                continue;
            };
            let parent = ctx.nodes().parent_node(node.id());
            let Some(member) = parent.kind().as_member_expression_kind() else {
                continue;
            };
            if member.object().span() != this_expression.span
                || no_this_in_sfc_is_inside_class_component(node, ctx, &custom_class_factories)
            {
                continue;
            }
            let Some(function_node) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    NoThisAstKind::Function(_) | NoThisAstKind::ArrowFunctionExpression(_)
                )
            }) else {
                continue;
            };
            if no_this_in_sfc_has_explicit_this_parameter(function_node)
                || !no_this_in_sfc_looks_like_component(function_node, ctx)
                || (curated_behavior && !function_contains_react_render_output(function_node, ctx))
                || no_this_in_sfc_has_own_this_member_write(function_node, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(this_expression.span));
        }
    }
}

fn no_this_in_sfc_custom_class_factories(ctx: &LintContext<'_>) -> Vec<String> {
    let Some(configured) = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react"))
        .and_then(|settings| settings.get("createClass"))
    else {
        return Vec::new();
    };
    if let Some(name) = configured.as_str() {
        return vec![name.to_owned()];
    }
    configured.as_array().map_or_else(Vec::new, |names| {
        names
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_owned)
            .collect()
    })
}

fn no_this_in_sfc_is_inside_class_component(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    custom_class_factories: &[String],
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(ancestor.kind(), NoThisAstKind::Class(_))
            || is_es5_component(ancestor)
            || matches!(ancestor.kind(), NoThisAstKind::CallExpression(call)
                if no_this_in_sfc_custom_class_factory_call(call, custom_class_factories))
    })
}

fn no_this_in_sfc_custom_class_factory_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    custom_class_factories: &[String],
) -> bool {
    if custom_class_factories.is_empty() {
        return false;
    }
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => custom_class_factories
            .iter()
            .any(|name| name == identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name)
            .is_some_and(|property| custom_class_factories.iter().any(|name| name == property)),
    }
}

fn no_this_in_sfc_has_explicit_this_parameter(function_node: &AstNode<'_>) -> bool {
    matches!(function_node.kind(), NoThisAstKind::Function(function) if function.this_param.is_some())
}

fn no_this_in_sfc_looks_like_component(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    if let NoThisAstKind::Function(function) = function_node.kind()
        && function.r#type == oxc_ast::ast::FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .is_some_and(|identifier| no_this_in_sfc_is_component_name(identifier.name.as_str()));
    }
    let mut current = function_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            NoThisAstKind::VariableDeclarator(declarator) => {
                return declarator
                    .id
                    .get_identifier_name()
                    .is_some_and(|name| no_this_in_sfc_is_component_name(name.as_ref()));
            }
            NoThisAstKind::AssignmentExpression(assignment) => {
                return assignment
                    .left
                    .get_identifier_name()
                    .is_some_and(|name| no_this_in_sfc_is_component_name(name.as_ref()));
            }
            NoThisAstKind::ObjectProperty(_)
            | NoThisAstKind::Function(_)
            | NoThisAstKind::ArrowFunctionExpression(_)
            | NoThisAstKind::Class(_)
            | NoThisAstKind::MethodDefinition(_)
            | NoThisAstKind::Program(_) => return false,
            _ => current = parent,
        }
    }
}

fn no_this_in_sfc_is_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn no_this_in_sfc_has_own_this_member_write(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !function_node.span().contains_inclusive(candidate.span())
            || !no_this_in_sfc_write_belongs_to_function(candidate, function_node, ctx)
        {
            return false;
        }
        let member = match candidate.kind() {
            NoThisAstKind::AssignmentExpression(assignment) => {
                assignment.left.as_member_expression()
            }
            NoThisAstKind::UpdateExpression(update) => update.argument.as_member_expression(),
            _ => None,
        };
        member.is_some_and(|member| {
            matches!(
                member.object().get_inner_expression(),
                Expression::ThisExpression(_)
            )
        })
    })
}

fn no_this_in_sfc_write_belongs_to_function(
    candidate: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == function_node.id() {
            return true;
        }
        if matches!(
            ancestor.kind(),
            NoThisAstKind::Function(_) | NoThisAstKind::Class(_)
        ) {
            return false;
        }
    }
    false
}
