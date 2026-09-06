use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};
use oxc_ast::{
    ast::{Expression, TSType as NoPropTypesTSType, TSTypeName as NoPropTypesTSTypeName},
    AstKind as NoPropTypesAstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId as NoPropTypesSymbolId;

#[derive(Debug, Default, Clone)]
pub struct NoPropTypes;

declare_oxc_lint!(
    /// Disallow propTypes contracts that React 19 no longer evaluates.
    NoPropTypes,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow propTypes ignored by React 19.",
);

impl Rule for NoPropTypes {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            NoPropTypesAstKind::AssignmentExpression(assignment)
                if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign =>
            {
                let Some(member) = assignment.left.as_member_expression() else {
                    return;
                };
                if member.static_property_name() != Some("propTypes") {
                    return;
                }
                let Expression::Identifier(component) = member.object().get_inner_expression()
                else {
                    return;
                };
                let name = component.name.as_str();
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(component.reference_id())
                    .symbol_id()
                else {
                    return;
                };
                if !name.starts_with(|character: char| character.is_ascii_uppercase())
                    || !is_proven_react_component_symbol(
                        symbol_id,
                        component.span.start,
                        ctx,
                        &mut Vec::new(),
                    )
                    || no_prop_types_has_only_unproven_array_map_output(symbol_id, ctx)
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(no_prop_types_message(name)).with_label(member.span()),
                );
            }
            NoPropTypesAstKind::PropertyDefinition(property)
                if property.r#static
                    && property.key.static_name().as_deref() == Some("propTypes") =>
            {
                let Some(class_node) = ctx
                    .nodes()
                    .ancestors(node.id())
                    .find(|ancestor| matches!(ancestor.kind(), NoPropTypesAstKind::Class(_)))
                else {
                    return;
                };
                let NoPropTypesAstKind::Class(class) = class_node.kind() else {
                    return;
                };
                if !is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new()) {
                    return;
                }
                let name = if let Some(identifier) = &class.id {
                    identifier.name.as_str()
                } else {
                    let expression_root = transparent_expression_root(class_node, ctx);
                    let parent = ctx.nodes().parent_node(expression_root.id());
                    let NoPropTypesAstKind::VariableDeclarator(declarator) = parent.kind() else {
                        return;
                    };
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        return;
                    };
                    binding.name.as_str()
                };
                if !name.starts_with(|character: char| character.is_ascii_uppercase()) {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(no_prop_types_message(name))
                        .with_label(property.key.span()),
                );
            }
            _ => {}
        }
    }
}

fn no_prop_types_message(component_name: &str) -> String {
    format!(
        "{component_name}.propTypes does nothing in React 19, so bad props reach your users with no warning. Describe props with TypeScript types & check risky data yourself."
    )
}

fn no_prop_types_has_only_unproven_array_map_output<'a>(
    symbol_id: NoPropTypesSymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node = match declaration.kind() {
        NoPropTypesAstKind::Function(_) => Some(declaration),
        NoPropTypesAstKind::VariableDeclarator(declarator) => declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
            .filter(|initializer| {
                matches!(
                    initializer,
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
            .and_then(|initializer| {
                ctx.nodes()
                    .iter()
                    .find(|candidate| candidate.span() == initializer.span())
            }),
        _ => None,
    };
    let Some(function_node) = function_node else {
        return false;
    };
    if function_returns_props_children(function_node, ctx) {
        return false;
    }
    let mut found_render_output = false;
    for candidate in ctx.nodes().iter().filter(|candidate| {
        function_node.span().contains_inclusive(candidate.span())
            && is_react_render_output_node(candidate, ctx)
            && render_output_reaches_function_return(candidate, function_node, ctx)
    }) {
        found_render_output = true;
        if !no_prop_types_render_output_crosses_unproven_array_map(candidate, function_node, ctx) {
            return false;
        }
    }
    found_render_output
}

fn no_prop_types_render_output_crosses_unproven_array_map<'a>(
    output_node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(output_node.id()) {
        if ancestor.id() == function_node.id() {
            return false;
        }
        if !matches!(
            ancestor.kind(),
            NoPropTypesAstKind::Function(_) | NoPropTypesAstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let callback_root = transparent_expression_root(ancestor, ctx);
        let parent = ctx.nodes().parent_node(callback_root.id());
        let NoPropTypesAstKind::CallExpression(call) = parent.kind() else {
            continue;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == callback_root.span())
        }) {
            continue;
        }
        let Some(member_expression) = call.callee.get_inner_expression().as_member_expression()
        else {
            continue;
        };
        if member_expression.static_property_name() != Some("map") {
            continue;
        }
        if !no_prop_types_is_proven_array_expression(
            member_expression.object(),
            call.span.start,
            ctx,
            &mut Vec::new(),
        ) || static_member_was_replaced_before(&call.callee, ctx)
        {
            return true;
        }
    }
    false
}

fn no_prop_types_is_proven_array_expression<'a>(
    expression: &'a Expression<'a>,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<NoPropTypesSymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::CallExpression(call) => {
            if !matches!(
                call.callee.get_inner_expression(),
                Expression::Identifier(_)
            ) {
                return false;
            }
            has_stable_call_target(call, ctx)
                && (module_api_path_matches(
                    &call.callee,
                    &[],
                    &[
                        "lodash/sortBy",
                        "lodash/sortBy.js",
                        "lodash-es/sortBy",
                        "lodash-es/sortBy.js",
                    ],
                    true,
                    ctx,
                ) || module_api_path_matches(
                    &call.callee,
                    &["sortBy"],
                    &["lodash", "lodash-es"],
                    false,
                    ctx,
                ))
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id)
                || symbol_has_write_before(symbol_id, reference_offset, ctx)
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let type_annotation = match declaration.kind() {
                NoPropTypesAstKind::VariableDeclarator(declarator) => {
                    declarator.type_annotation.as_ref()
                }
                NoPropTypesAstKind::FormalParameter(parameter) => {
                    parameter.type_annotation.as_ref()
                }
                _ => None,
            };
            if type_annotation.is_some_and(|annotation| {
                no_prop_types_is_array_type_annotation(&annotation.type_annotation)
            }) {
                return true;
            }
            let NoPropTypesAstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let Some(initializer) = &declarator.init else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            no_prop_types_is_proven_array_expression(
                initializer,
                reference_offset,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => false,
    }
}

fn no_prop_types_is_array_type_annotation(type_node: &NoPropTypesTSType<'_>) -> bool {
    match type_node {
        NoPropTypesTSType::TSArrayType(_) | NoPropTypesTSType::TSTupleType(_) => true,
        NoPropTypesTSType::TSTypeReference(reference) => matches!(
            &reference.type_name,
            NoPropTypesTSTypeName::IdentifierReference(identifier)
                if matches!(identifier.name.as_str(), "Array" | "ReadonlyArray")
        ),
        _ => false,
    }
}
