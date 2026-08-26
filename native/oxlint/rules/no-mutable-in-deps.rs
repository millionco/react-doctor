use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, BindingPattern, Expression, FunctionBody, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const HOOKS_WITH_DEPENDENCIES: [&str; 4] =
    ["useEffect", "useLayoutEffect", "useMemo", "useCallback"];
const MUTABLE_GLOBAL_ROOTS: [&str; 7] = [
    "location",
    "window",
    "document",
    "navigator",
    "history",
    "screen",
    "performance",
];

#[derive(Debug, Default, Clone)]
pub struct NoMutableInDeps;

declare_oxc_lint!(
    /// Disallow mutable values in React hook dependency arrays.
    NoMutableInDeps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow mutable values in React hook dependency arrays.",
);

impl Rule for NoMutableInDeps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function) if function.is_function_declaration() => {
                    let Some(identifier) = &function.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    if let Some(body) = &function.body {
                        check_component(function.node_id.get(), &function.params.items, body, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::FunctionExpression(function)) => {
                            if let Some(body) = &function.body {
                                check_component(
                                    function.node_id.get(),
                                    &function.params.items,
                                    body,
                                    ctx,
                                );
                            }
                        }
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            if let Some(body) = function.body.as_function_body() {
                                check_component(
                                    function.node_id.get(),
                                    &function.params.items,
                                    body,
                                    ctx,
                                );
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn check_component<'a>(
    component_node_id: NodeId,
    parameters: &'a [oxc_ast::ast::FormalParameter<'a>],
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) {
    let mutable_dependencies = collect_mutable_dependency_candidates(body, ctx);
    if mutable_dependencies.is_empty() {
        return;
    }

    let use_ref_binding_names = collect_use_ref_binding_names(body, ctx);
    let mut local_binding_names = collect_local_binding_names(component_node_id, body, ctx);
    for parameter in parameters {
        collect_binding_pattern_names(&parameter.pattern, &mut local_binding_names);
    }

    for dependency in mutable_dependencies {
        let Some(member_expression) = dependency.as_member_expression() else {
            continue;
        };
        if let oxc_ast::ast::MemberExpression::StaticMemberExpression(member) = member_expression
            && member.property.name == "current"
            && let Expression::Identifier(identifier) = &member.object
            && use_ref_binding_names.contains(identifier.name.as_str())
        {
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "Changing \"{}.current\" does not re-render the component, so this dependency will not make the effect run again.",
                    identifier.name
                ))
                .with_label(dependency.span()),
            );
            continue;
        }

        let Some(root_name) = root_identifier_name(dependency) else {
            continue;
        };
        if MUTABLE_GLOBAL_ROOTS.contains(&root_name) && !local_binding_names.contains(root_name) {
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "Values like \"{root_name}.*\" can change without re-rendering the component, so this dependency will not make the effect run again."
                ))
                .with_label(dependency.span()),
            );
        }
    }
}

fn collect_mutable_dependency_candidates<'a>(
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    let mut dependencies = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        if !body.span.contains_inclusive(call.span)
            || !is_react_hook_call(call, &HOOKS_WITH_DEPENDENCIES, ctx)
        {
            continue;
        }
        let Some(Expression::ArrayExpression(dependency_array)) =
            call.arguments.get(1).and_then(Argument::as_expression)
        else {
            continue;
        };
        dependencies.extend(
            dependency_array
                .elements
                .iter()
                .filter_map(ArrayExpressionElement::as_expression)
                .filter(|dependency| dependency.as_member_expression().is_some()),
        );
    }
    dependencies
}

fn collect_use_ref_binding_names<'a>(
    body: &FunctionBody<'a>,
    ctx: &LintContext<'a>,
) -> rustc_hash::FxHashSet<String> {
    let mut names = rustc_hash::FxHashSet::default();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call)) = &declarator.init else {
                continue;
            };
            if is_react_hook_call(call, &["useRef"], ctx) {
                names.insert(identifier.name.to_string());
            }
        }
    }
    names
}

fn collect_local_binding_names(
    component_node_id: NodeId,
    body: &FunctionBody<'_>,
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<String> {
    let mut names = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            continue;
        };
        if !body.span.contains_inclusive(declarator.span)
            || nearest_function_node_id(node.id(), ctx) != Some(component_node_id)
        {
            continue;
        }
        collect_binding_pattern_names(&declarator.id, &mut names);
    }
    names
}

fn nearest_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(|ancestor| ancestor.id())
}

fn root_identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let mut cursor = expression;
    loop {
        cursor = cursor.get_inner_expression();
        if let Expression::Identifier(identifier) = cursor {
            return Some(identifier.name.as_str());
        }
        cursor = cursor.as_member_expression()?.object();
    }
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
