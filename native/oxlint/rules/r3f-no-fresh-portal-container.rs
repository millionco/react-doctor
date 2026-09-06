use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoFreshPortalContainer;

impl RuleMeta for R3FNoFreshPortalContainer {
    const NAME: &'static str = "r3f-no-fresh-portal-container";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow fresh R3F portal containers during render.",
    };
}

impl Rule for R3FNoFreshPortalContainer {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let portal_call_nodes = ctx
            .nodes()
            .iter()
            .filter(|node| {
                matches!(node.kind(), AstKind::CallExpression(call_expression)
                if module_api_reference_might_match(
                    &call_expression.callee,
                    "createPortal",
                    &R3F_PUBLIC_MODULES,
                    ctx,
                ))
            })
            .collect::<Vec<_>>();
        if portal_call_nodes.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        for node in portal_call_nodes {
            check_fresh_portal_container(node, &analysis, ctx);
        }
    }
}

fn check_fresh_portal_container<'a>(
    node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) {
    let AstKind::CallExpression(call_expression) = node.kind() else {
        return;
    };
    if !module_api_reference_matches(
        &call_expression.callee,
        "createPortal",
        &R3F_PUBLIC_MODULES,
        analysis,
        ctx,
    ) || find_render_phase_component_or_hook(node, ctx).is_none()
        || portal_is_stable_hook_value(node, analysis, ctx)
        || portal_is_inside_stable_hook_initializer(node, analysis, ctx)
    {
        return;
    }
    let Some(container_argument) = call_expression
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return;
    };
    let Some(fresh_kind) = resolve_r3f_fresh_value(container_argument, ctx, &["instance", "clone"])
    else {
        return;
    };
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "This {fresh_kind} gives createPortal a different container on every render, forcing R3F to rebuild or remount portal state and event handling. Reuse a stable container"
        ))
        .with_label(container_argument.span()),
    );
}

fn portal_is_stable_hook_value<'a>(
    node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(hook_call) = parent.kind() else {
        return false;
    };
    expression_is_argument_at(&hook_call.arguments, 0, expression_root.span())
        && ["useRef", "useState"]
            .iter()
            .any(|hook_name| r3f_react_api_call_matches(hook_call, hook_name, analysis, ctx))
}

fn portal_is_inside_stable_hook_initializer<'a>(
    node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(mut enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    loop {
        let callback_root = transparent_expression_root(enclosing_function, ctx);
        let parent = ctx.nodes().parent_node(callback_root.id());
        if let AstKind::CallExpression(hook_call) = parent.kind()
            && expression_is_argument_at(&hook_call.arguments, 0, callback_root.span())
            && (r3f_react_api_call_matches(hook_call, "useState", analysis, ctx)
                || (r3f_react_api_call_matches(hook_call, "useMemo", analysis, ctx)
                    && hook_call
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

fn r3f_react_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    direct_react_api_call_matches(call_expression, api_name, ctx)
        || module_api_reference_matches(
            &call_expression.callee,
            api_name,
            &REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn direct_react_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if callee.as_member_expression().is_some() {
        return is_react_api_call(call_expression, api_name, ctx);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = callee else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == api_name
            )
    })
}
