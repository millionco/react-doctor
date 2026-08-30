use oxc_ast::{
    AstKind,
    ast::{
        Expression, FunctionType, JSXElementName, JSXMemberExpression, JSXMemberExpressionObject,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, ScopeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct PreferModuleScopePureFunction;

#[derive(Default)]
struct PureFunctionAnalysis {
    captured_symbol_scopes_by_function: FxHashMap<NodeId, FxHashSet<ScopeId>>,
    object_returning_functions: FxHashSet<NodeId>,
}

struct PureFunctionCandidate {
    function_id: NodeId,
    binding_name: String,
}

declare_oxc_lint!(
    /// Warns when a pure function is rebuilt inside a React component or hook.
    PreferModuleScopePureFunction,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Warns when a pure function is rebuilt inside a React component or hook.",
);

impl Rule for PreferModuleScopePureFunction {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let mut analysis = pure_function_build_analysis(ctx);
        let mut candidates = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::VariableDeclarator(declarator) => {
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    if pure_function_is_pascal_case(binding.name.as_str()) {
                        continue;
                    }
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let function_id = match initializer {
                        Expression::ArrowFunctionExpression(function) => function.node_id.get(),
                        Expression::FunctionExpression(function) => function.node_id.get(),
                        _ => continue,
                    };
                    candidates.push(PureFunctionCandidate {
                        function_id,
                        binding_name: binding.name.to_string(),
                    });
                }
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration =>
                {
                    let Some(binding) = &function.id else {
                        continue;
                    };
                    if pure_function_is_pascal_case(binding.name.as_str()) {
                        continue;
                    }
                    candidates.push(PureFunctionCandidate {
                        function_id: node.id(),
                        binding_name: binding.name.to_string(),
                    });
                }
                _ => {}
            }
        }

        let viable_function_ids = candidates
            .iter()
            .filter_map(|candidate| {
                let function_node = ctx.nodes().get_node(candidate.function_id);
                (!pure_function_is_assigned_to_component_member(function_node, ctx)
                    && pure_function_enclosing_component_or_hook(function_node, &analysis, ctx)
                        .is_some())
                .then_some(candidate.function_id)
            })
            .collect::<FxHashSet<_>>();
        pure_function_collect_captures(&viable_function_ids, &mut analysis, ctx);

        for candidate in candidates {
            pure_function_check_named_function(
                ctx.nodes().get_node(candidate.function_id),
                &candidate.binding_name,
                &analysis,
                ctx,
            );
        }
    }
}

fn pure_function_is_assigned_to_component_member(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        ctx.nodes().parent_node(function_node.id()).kind(),
        AstKind::AssignmentExpression(assignment) if assignment.left.as_member_expression().is_some()
    )
}

fn pure_function_check_named_function<'a>(
    function_node: &AstNode<'a>,
    binding_name: &str,
    analysis: &PureFunctionAnalysis,
    ctx: &LintContext<'a>,
) {
    if pure_function_is_assigned_to_component_member(function_node, ctx) {
        return;
    }
    let Some((component_node, component_name)) =
        pure_function_enclosing_component_or_hook(function_node, analysis, ctx)
    else {
        return;
    };
    if pure_function_has_component_local_capture(function_node, component_node, analysis, ctx) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "`{binding_name}` inside `{component_name}` uses no local state but is rebuilt on every render, so it wastes work & breaks memoized children. Move it to the top of the file, outside the component."
        ))
        .with_label(function_node.span()),
    );
}

fn pure_function_enclosing_component_or_hook<'a, 'b>(
    function_node: &'b AstNode<'a>,
    analysis: &PureFunctionAnalysis,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b AstNode<'a>, &'b str)> {
    let parent = ctx.nodes().parent_node(function_node.id());
    let enclosing_function = crate::ast_util::get_enclosing_function(parent, ctx)?;
    let display_name = pure_function_component_or_hook_name(enclosing_function, ctx)?;
    if !pure_function_is_react_hook_name(display_name)
        && analysis
            .object_returning_functions
            .contains(&enclosing_function.id())
    {
        return None;
    }
    Some((enclosing_function, display_name))
}

fn pure_function_has_component_local_capture(
    function_node: &AstNode<'_>,
    component_node: &AstNode<'_>,
    analysis: &PureFunctionAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(component_scope_id) = pure_function_own_scope_id(component_node) else {
        return true;
    };
    analysis
        .captured_symbol_scopes_by_function
        .get(&function_node.id())
        .is_some_and(|symbol_scope_ids| {
            symbol_scope_ids.iter().any(|symbol_scope_id| {
                ctx.scoping()
                    .scope_ancestors(*symbol_scope_id)
                    .any(|scope_id| scope_id == component_scope_id)
            })
        })
}

fn pure_function_component_or_hook_name<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    if let AstKind::Function(function) = function_node.kind()
        && matches!(
            function.r#type,
            FunctionType::FunctionDeclaration | FunctionType::FunctionExpression
        )
        && let Some(identifier) = &function.id
    {
        return pure_function_is_react_component_or_hook_name(identifier.name.as_str())
            .then_some(identifier.name.as_str());
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            break;
        };
        let is_first_argument = call.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
        });
        if !is_first_argument
            || !pure_function_hoc_callee_name(&call.callee)
                .is_some_and(|name| matches!(name, "memo" | "forwardRef" | "observer" | "lazy"))
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .filter(|identifier| {
            declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == expression_root.span())
                && pure_function_is_react_component_or_hook_name(identifier.name.as_str())
        })
        .map(|identifier| identifier.name.as_str())
}

fn pure_function_hoc_callee_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    let mut callee = callee.get_inner_expression();
    while let Expression::SequenceExpression(sequence) = callee {
        callee = sequence.expressions.last()?.get_inner_expression();
    }
    match callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        Expression::ComputedMemberExpression(member) => match &member.expression {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn pure_function_build_analysis(ctx: &LintContext<'_>) -> PureFunctionAnalysis {
    let mut analysis = PureFunctionAnalysis::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::ArrowFunctionExpression(function)
                if function.get_expression().is_some_and(|expression| {
                    matches!(
                        expression.get_inner_expression(),
                        Expression::ObjectExpression(_)
                    )
                }) =>
            {
                analysis.object_returning_functions.insert(node.id());
            }
            AstKind::ReturnStatement(return_statement)
                if return_statement.argument.as_ref().is_some_and(|argument| {
                    matches!(
                        argument.get_inner_expression(),
                        Expression::ObjectExpression(_)
                    )
                }) =>
            {
                if let Some(owner) = crate::ast_util::get_enclosing_function(node, ctx) {
                    analysis.object_returning_functions.insert(owner.id());
                }
            }
            _ => {}
        }
    }
    analysis
}

fn pure_function_collect_captures(
    viable_function_ids: &FxHashSet<NodeId>,
    analysis: &mut PureFunctionAnalysis,
    ctx: &LintContext<'_>,
) {
    if viable_function_ids.is_empty() {
        return;
    }
    let mut symbol_scope_ancestors_by_symbol = FxHashMap::default();
    for node in ctx.nodes().iter() {
        let symbol_id = match node.kind() {
            AstKind::IdentifierReference(identifier) => {
                let reference = ctx.scoping().get_reference(identifier.reference_id());
                if reference.is_type() {
                    None
                } else {
                    reference.symbol_id()
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                pure_function_jsx_root_symbol_id(opening_element, ctx)
            }
            _ => None,
        };
        let Some(symbol_id) = symbol_id else {
            continue;
        };
        pure_function_record_symbol_capture(
            node,
            symbol_id,
            viable_function_ids,
            &mut symbol_scope_ancestors_by_symbol,
            analysis,
            ctx,
        );
    }
}

fn pure_function_record_symbol_capture(
    reference_node: &AstNode<'_>,
    symbol_id: SymbolId,
    viable_function_ids: &FxHashSet<NodeId>,
    symbol_scope_ancestors_by_symbol: &mut FxHashMap<SymbolId, FxHashSet<ScopeId>>,
    analysis: &mut PureFunctionAnalysis,
    ctx: &LintContext<'_>,
) {
    let declaration = ctx.symbol_declaration(symbol_id);
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    let symbol_scope_ancestors = symbol_scope_ancestors_by_symbol
        .entry(symbol_id)
        .or_insert_with(|| {
            ctx.scoping()
                .scope_ancestors(symbol_scope_id)
                .collect::<FxHashSet<_>>()
        });
    for ancestor in ctx
        .nodes()
        .ancestors(reference_node.id())
        .filter(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    {
        if declaration.id() == ancestor.id() {
            break;
        }
        let Some(function_scope_id) = pure_function_own_scope_id(ancestor) else {
            continue;
        };
        if symbol_scope_ancestors.contains(&function_scope_id) {
            break;
        }
        if viable_function_ids.contains(&ancestor.id()) {
            analysis
                .captured_symbol_scopes_by_function
                .entry(ancestor.id())
                .or_default()
                .insert(symbol_scope_id);
        }
    }
}

fn pure_function_jsx_root_symbol_id(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let identifier = match &opening_element.name {
        JSXElementName::IdentifierReference(identifier) => identifier,
        JSXElementName::MemberExpression(member) => pure_function_jsx_member_root(member)?,
        _ => return None,
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn pure_function_jsx_member_root<'a>(
    member: &'a JSXMemberExpression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => Some(identifier),
        JSXMemberExpressionObject::MemberExpression(parent) => {
            pure_function_jsx_member_root(parent)
        }
        JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}

fn pure_function_own_scope_id(function_node: &AstNode<'_>) -> Option<ScopeId> {
    match function_node.kind() {
        AstKind::Function(function) => function.scope_id.get(),
        AstKind::ArrowFunctionExpression(function) => function.scope_id.get(),
        _ => None,
    }
}

fn pure_function_is_react_component_or_hook_name(name: &str) -> bool {
    pure_function_is_pascal_case(name) || pure_function_is_react_hook_name(name)
}

fn pure_function_is_react_hook_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.starts_with(b"use")
        && (bytes.len() == 3
            || bytes.get(3).is_some_and(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit()
            }))
}

fn pure_function_is_pascal_case(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
