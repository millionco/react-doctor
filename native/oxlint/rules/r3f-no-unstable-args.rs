use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, Expression, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_UNSTABLE_ARGS_REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoUnstableArgs;

impl RuleMeta for R3FNoUnstableArgs {
    const NAME: &'static str = "r3f-no-unstable-args";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow unstable reference-valued R3F constructor arguments.",
    };
}

impl Rule for R3FNoUnstableArgs {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }

        let candidates = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                if !r3f_unstable_args_is_host_intrinsic(opening_element) {
                    return None;
                }
                let expression = get_authoritative_jsx_attribute(opening_element, "args", true)
                    .and_then(jsx_attribute_expression)?;
                let fresh_kind = r3f_unstable_args_element(
                    expression,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                )?;
                find_render_phase_component_or_hook(node, ctx)
                    .is_some()
                    .then_some((node.id(), fresh_kind))
            })
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        for (node_id, fresh_kind) in candidates {
            let node = ctx.nodes().get_node(node_id);
            if r3f_unstable_args_is_inside_stable_initializer(node, &analysis, ctx) {
                continue;
            }
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some(expression) = get_authoritative_jsx_attribute(opening_element, "args", true)
                .and_then(jsx_attribute_expression)
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This {fresh_kind} is a new constructor argument on every render, so React Three Fiber may reconstruct and dispose the Three.js object. Memoize it or move it to module scope"
                ))
                .with_label(expression.span()),
            );
        }
    }
}

fn r3f_unstable_args_is_host_intrinsic(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let JSXElementName::Identifier(identifier) = &opening_element.name else {
        return false;
    };
    let element_name = identifier.name.as_str();
    !element_name.contains('-')
        && element_name
            .chars()
            .next()
            .is_some_and(|first_character| !first_character.is_uppercase())
        && !crate::globals::HTML_TAG.contains(element_name)
        && (!is_svg_tag_name(element_name) || element_name == "line")
}

fn r3f_unstable_args_element<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> Option<&'static str> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                .is_top()
                || !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return None;
            }
            r3f_unstable_args_element(declarator.init.as_ref()?, ctx, visited_symbol_ids)
        }
        Expression::ConditionalExpression(conditional_expression) => r3f_unstable_args_element(
            &conditional_expression.consequent,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
        .or_else(|| {
            r3f_unstable_args_element(
                &conditional_expression.alternate,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }),
        Expression::LogicalExpression(logical_expression) => r3f_unstable_args_element(
            &logical_expression.left,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
        .or_else(|| {
            r3f_unstable_args_element(
                &logical_expression.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }),
        Expression::ArrayExpression(array_expression) => {
            for element in &array_expression.elements {
                match element {
                    ArrayExpressionElement::SpreadElement(spread_element) => {
                        if let Some(fresh_kind) = r3f_unstable_args_element(
                            &spread_element.argument,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                        ) {
                            return Some(fresh_kind);
                        }
                    }
                    ArrayExpressionElement::Elision(_) => {}
                    element => {
                        if let Some(fresh_kind) = ArrayExpressionElement::as_expression(element)
                            .and_then(|element_expression| {
                                resolve_r3f_fresh_value(element_expression, ctx, &[])
                            })
                        {
                            return Some(fresh_kind);
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn r3f_unstable_args_is_inside_stable_initializer<'a>(
    node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if is_inside_stable_r3f_react_initializer(node, analysis, ctx) {
        return true;
    }
    let Some(mut enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    loop {
        let callback_root = transparent_expression_root(enclosing_function, ctx);
        let parent = ctx.nodes().parent_node(callback_root.id());
        if let AstKind::CallExpression(call_expression) = parent.kind()
            && expression_is_argument_at(&call_expression.arguments, 0, callback_root.span())
            && (r3f_unstable_args_type_import_react_call_matches(
                call_expression,
                "useState",
                analysis,
                ctx,
            ) || (r3f_unstable_args_type_import_react_call_matches(
                call_expression,
                "useMemo",
                analysis,
                ctx,
            ) && call_expression
                .arguments
                .get(1)
                .is_some_and(|argument| !argument.is_spread())))
        {
            return true;
        }
        let Some(outer_function) =
            ctx.nodes()
                .ancestors(enclosing_function.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
        else {
            return false;
        };
        enclosing_function = outer_function;
    }
}

fn r3f_unstable_args_type_import_react_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    type_import_module_api_reference_matches(
        &call_expression.callee,
        api_name,
        &R3F_UNSTABLE_ARGS_REACT_RUNTIME_MODULES,
        analysis,
        ctx,
    )
}
