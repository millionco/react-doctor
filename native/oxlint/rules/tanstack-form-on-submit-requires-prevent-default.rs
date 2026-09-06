use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "This submit handler calls the form's handleSubmit without event.preventDefault(), so the browser still performs a native full-page form submission and the app reloads mid-submit. Call event.preventDefault() before handleSubmit().";
const TANSTACK_FORM_MODULES: [&str; 1] = ["@tanstack/react-form"];

#[derive(Debug, Default, Clone)]
pub struct TanstackFormOnSubmitRequiresPreventDefault;

declare_oxc_lint!(
    /// Require preventDefault around TanStack Form handleSubmit.
    TanstackFormOnSubmitRequiresPreventDefault,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require preventDefault around TanStack Form submissions.",
);

impl Rule for TanstackFormOnSubmitRequiresPreventDefault {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening) = node.kind() else {
                continue;
            };
            if !matches!(&opening.name, oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "form")
            {
                continue;
            }
            let Some(attribute) = find_jsx_attribute(opening, "onSubmit") else {
                continue;
            };
            let Some(handler) = jsx_attribute_expression(attribute) else {
                continue;
            };
            let fires = tanstack_form_is_handle_submit_reference(handler, ctx, &mut Vec::new())
                || exact_local_function_id_including_generators(
                    handler,
                    ctx,
                    &mut Vec::new(),
                    &mut resolution_cache,
                )
                .is_some_and(|function_id| {
                    let calls_submit = node_index.node_ids(function_id).iter().any(|&node_id| {
                        let AstKind::CallExpression(call) = ctx.nodes().get_node(node_id).kind()
                        else {
                            return false;
                        };
                        tanstack_form_is_handle_submit_reference(&call.callee, ctx, &mut Vec::new())
                    });
                    calls_submit
                        && !tanstack_form_function_definitely_prevents_default(
                            function_id,
                            &node_index,
                            ctx,
                        )
                });
            if fires {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span()));
            }
        }
    }
}

fn tanstack_form_is_handle_submit_reference<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("handleSubmit")
        && tanstack_form_is_instance(member.object(), ctx, visited)
}

fn tanstack_form_is_instance<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression {
        return module_api_path_matches(
            &call.callee,
            &["useForm"],
            &TANSTACK_FORM_MODULES,
            false,
            ctx,
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited.contains(&symbol_id) {
        return false;
    }
    visited.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| tanstack_form_is_instance(initializer, ctx, visited))
}

fn tanstack_form_function_definitely_prevents_default<'a>(
    function_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    let parameter = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.params.items.first().map(|item| &item.pattern),
        AstKind::ArrowFunctionExpression(function) => {
            function.params.items.first().map(|item| &item.pattern)
        }
        _ => None,
    };
    let Some(oxc_ast::ast::BindingPattern::BindingIdentifier(parameter)) = parameter else {
        return false;
    };
    let event_symbol_id = parameter.symbol_id();
    let mut found_prevention = false;
    let mut has_control_flow = false;
    for &candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        if matches!(
            candidate.kind(),
            AstKind::ConditionalExpression(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::IfStatement(_)
                | AstKind::LogicalExpression(_)
                | AstKind::ReturnStatement(_)
                | AstKind::SwitchStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::ThrowStatement(_)
                | AstKind::TryStatement(_)
                | AstKind::WhileStatement(_)
        ) {
            has_control_flow = true;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            continue;
        };
        if member.static_property_name() == Some("preventDefault")
            && ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                == Some(event_symbol_id)
        {
            found_prevention = true;
        }
    }
    found_prevention && !has_control_flow
}
