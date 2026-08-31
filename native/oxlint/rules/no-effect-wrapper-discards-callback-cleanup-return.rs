use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, FormalParameter, TSType, TSTypeName,
        TSTypeQueryExprName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoEffectWrapperDiscardsCallbackCleanupReturn;

declare_oxc_lint!(
    /// Warns when an effect wrapper discards a forwarded cleanup return.
    NoEffectWrapperDiscardsCallbackCleanupReturn,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Effect wrapper discards a forwarded cleanup return.",
);

impl Rule for NoEffectWrapperDiscardsCallbackCleanupReturn {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &["useEffect", "useLayoutEffect"], ctx) {
            return;
        }
        let Some(callback) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let callback_id = match callback.get_inner_expression() {
            Expression::ArrowFunctionExpression(function)
                if function.get_expression().is_none() =>
            {
                ctx.nodes().iter().find_map(|candidate| {
                    matches!(candidate.kind(), AstKind::ArrowFunctionExpression(candidate_function)
                        if candidate_function.span == function.span)
                    .then_some(candidate.id())
                })
            }
            Expression::FunctionExpression(function) if function.body.is_some() => {
                ctx.nodes().iter().find_map(|candidate| {
                    matches!(candidate.kind(), AstKind::Function(candidate_function)
                        if candidate_function.span == function.span)
                    .then_some(candidate.id())
                })
            }
            _ => None,
        };
        let Some(callback_id) = callback_id else {
            return;
        };
        let Some(wrapper_id) = effect_wrapper_nearest_function(node.id(), ctx) else {
            return;
        };
        let wrapper_node = ctx.nodes().get_node(wrapper_id);
        let Some(wrapper_name) = component_or_hook_function_name(wrapper_node, ctx) else {
            return;
        };
        if !effect_wrapper_is_hook_name(wrapper_name) {
            return;
        }
        let Some((callback_name, callback_symbol_id)) =
            effect_wrapper_forwarded_parameter(wrapper_id, ctx)
        else {
            return;
        };
        let callback_span = ctx.nodes().get_node(callback_id).span();
        let mut discarded_calls = ctx
            .nodes()
            .iter()
            .filter_map(|candidate| {
                let AstKind::CallExpression(call) = candidate.kind() else {
                    return None;
                };
                if !callback_span.contains_inclusive(call.span)
                    || effect_wrapper_nearest_function(candidate.id(), ctx) != Some(callback_id)
                    || !effect_wrapper_call_targets_parameter(call, callback_symbol_id, ctx)
                    || effect_wrapper_is_null_detach_call(call)
                    || !effect_wrapper_call_result_is_discarded(candidate.id(), callback_id, ctx)
                    || symbol_has_write_before(callback_symbol_id, call.span.start, ctx)
                {
                    return None;
                }
                Some((call.span.start, call))
            })
            .collect::<Vec<_>>();
        discarded_calls.sort_unstable_by_key(|(start, _)| *start);
        let Some((_, discarded_call)) = discarded_calls.first() else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This forwards an EffectCallback but calls it as a bare statement, so the cleanup it returns is discarded and never runs (leaking its subscriptions/timers/listeners). Return it instead: `return {callback_name}();`."
            ))
            .with_label(discarded_call.span),
        );
    }
}

fn effect_wrapper_nearest_function(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn effect_wrapper_is_hook_name(name: &str) -> bool {
    name.starts_with("use") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn effect_wrapper_forwarded_parameter(
    wrapper_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<(String, SymbolId)> {
    let parameters = match ctx.nodes().get_node(wrapper_id).kind() {
        AstKind::Function(function) => function.params.items.as_slice(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.as_slice(),
        _ => return None,
    };
    if effect_wrapper_binding_is_effect_hook_type(wrapper_id, ctx) {
        return effect_wrapper_parameter_binding(parameters.first()?);
    }
    parameters
        .iter()
        .find(|parameter| effect_wrapper_parameter_can_return_cleanup(parameter, ctx))
        .and_then(effect_wrapper_parameter_binding)
}

fn effect_wrapper_parameter_binding(parameter: &FormalParameter<'_>) -> Option<(String, SymbolId)> {
    match &parameter.pattern {
        BindingPattern::BindingIdentifier(binding) => {
            Some((binding.name.to_string(), binding.symbol_id()))
        }
        BindingPattern::AssignmentPattern(assignment) => {
            let BindingPattern::BindingIdentifier(binding) = &assignment.left else {
                return None;
            };
            Some((binding.name.to_string(), binding.symbol_id()))
        }
        _ => None,
    }
}

fn effect_wrapper_binding_is_effect_hook_type(wrapper_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let wrapper = ctx.nodes().get_node(wrapper_id);
    for ancestor in ctx.nodes().ancestors(wrapper.id()) {
        let AstKind::VariableDeclarator(declarator) = ancestor.kind() else {
            continue;
        };
        if !declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span().contains_inclusive(wrapper.span()))
        {
            return false;
        }
        return declarator
            .type_annotation
            .as_ref()
            .is_some_and(|annotation| {
                effect_wrapper_annotation_is_effect_hook_type(&annotation.type_annotation, ctx)
            });
    }
    false
}

fn effect_wrapper_annotation_is_effect_hook_type(
    annotation: &TSType<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let TSType::TSTypeQuery(query) = annotation else {
        return false;
    };
    match &query.expr_name {
        TSTypeQueryExprName::IdentifierReference(identifier) => {
            matches!(identifier.name.as_str(), "useEffect" | "useLayoutEffect")
                && effect_wrapper_type_identifier_is_react_import(
                    identifier,
                    identifier.name.as_str(),
                    ctx,
                )
        }
        TSTypeQueryExprName::QualifiedName(qualified) => {
            matches!(
                qualified.right.name.as_str(),
                "useEffect" | "useLayoutEffect"
            ) && matches!(&qualified.left, TSTypeName::IdentifierReference(identifier)
                    if identifier.name == "React"
                        && effect_wrapper_type_identifier_is_react_namespace(identifier, ctx))
        }
        TSTypeQueryExprName::ThisExpression(_) | TSTypeQueryExprName::TSImportType(_) => false,
    }
}

fn effect_wrapper_parameter_can_return_cleanup(
    parameter: &FormalParameter<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(annotation) = parameter.type_annotation.as_ref() else {
        return false;
    };
    match &annotation.type_annotation {
        TSType::TSTypeReference(reference) => match &reference.type_name {
            TSTypeName::IdentifierReference(identifier) => {
                effect_wrapper_type_identifier_is_react_import(identifier, "EffectCallback", ctx)
            }
            TSTypeName::QualifiedName(qualified) => {
                qualified.right.name == "EffectCallback"
                    && matches!(&qualified.left, TSTypeName::IdentifierReference(identifier)
                        if identifier.name == "React"
                            && effect_wrapper_type_identifier_is_react_namespace(identifier, ctx))
            }
            TSTypeName::ThisExpression(_) => false,
        },
        TSType::TSFunctionType(function) => {
            effect_wrapper_type_contains_cleanup_function(&function.return_type.type_annotation)
        }
        _ => false,
    }
}

fn effect_wrapper_type_contains_cleanup_function(type_node: &TSType<'_>) -> bool {
    match type_node {
        TSType::TSFunctionType(_) => true,
        TSType::TSUnionType(union) => union
            .types
            .iter()
            .any(effect_wrapper_type_contains_cleanup_function),
        TSType::TSParenthesizedType(parenthesized) => {
            effect_wrapper_type_contains_cleanup_function(&parenthesized.type_annotation)
        }
        _ => false,
    }
}

fn effect_wrapper_type_identifier_is_react_import(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    imported_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return identifier.name == imported_name;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(name)
                if name.name() == imported_name)
    })
}

fn effect_wrapper_type_identifier_is_react_namespace(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::Default(_)
                    | crate::module_record::ImportImportName::NamespaceObject
            )
    })
}

fn effect_wrapper_call_targets_parameter(
    call: &oxc_ast::ast::CallExpression<'_>,
    callback_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
        == Some(callback_symbol_id)
}

fn effect_wrapper_is_null_detach_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    matches!(call.arguments.as_slice(), [Argument::NullLiteral(_)])
}

fn effect_wrapper_call_result_is_discarded(
    call_id: NodeId,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut expression_id = call_id;
    for ancestor in ctx.nodes().ancestors(call_id) {
        match ancestor.kind() {
            AstKind::ExpressionStatement(_) => return true,
            AstKind::ReturnStatement(_) => return false,
            AstKind::UnaryExpression(unary) if unary.operator.is_void() => return true,
            AstKind::SequenceExpression(sequence) => {
                let expression_span = ctx.nodes().get_node(expression_id).span();
                if sequence
                    .expressions
                    .last()
                    .is_none_or(|last| last.span() != expression_span)
                {
                    return true;
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if ancestor.id() != callback_id =>
            {
                return false;
            }
            _ => {}
        }
        expression_id = ancestor.id();
        if ancestor.id() == callback_id {
            return false;
        }
    }
    false
}
