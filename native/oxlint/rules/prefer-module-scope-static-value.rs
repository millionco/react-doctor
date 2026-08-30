use oxc_ast::{
    AstKind,
    ast::{
        Expression, FunctionType, JSXElementName, JSXMemberExpression, JSXMemberExpressionObject,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, ScopeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MUTATING_RECEIVER_METHOD_NAMES: [&str; 13] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
    "add",
    "clear",
    "delete",
    "set",
];
const SCALAR_LOOKUP_METHOD_NAMES: [&str; 8] = [
    "includes",
    "indexOf",
    "lastIndexOf",
    "has",
    "some",
    "every",
    "find",
    "findIndex",
];
const IMPURE_BARE_CALL_NAMES: [&str; 9] = [
    "nanoid",
    "uuid",
    "v4",
    "cuid",
    "ulid",
    "createId",
    "randomUUID",
    "generateId",
    "random",
];
const NODE_CRYPTO_MODULE_SOURCES: [&str; 2] = ["crypto", "node:crypto"];

#[derive(Debug, Default, Clone)]
pub struct PreferModuleScopeStaticValue;

#[derive(Default)]
struct StaticValueAnalysis {
    candidate_ids: Vec<NodeId>,
    initializer_node_ids: Vec<NodeId>,
    object_returning_function_ids: FxHashSet<NodeId>,
}

declare_oxc_lint!(
    /// Warns when a static array or object is rebuilt inside a component or hook.
    PreferModuleScopeStaticValue,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Warns when a static value is rebuilt inside a component or hook.",
);

impl Rule for PreferModuleScopeStaticValue {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let analysis = static_value_build_analysis(ctx);
        for candidate_id in &analysis.candidate_ids {
            let candidate_node = ctx.nodes().get_node(*candidate_id);
            let AstKind::VariableDeclarator(declarator) = candidate_node.kind() else {
                continue;
            };
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let Some((component_node, component_name, component_scope_id)) =
                static_value_enclosing_component(candidate_node, &analysis, ctx)
            else {
                continue;
            };
            if static_value_initializer_is_unsafe(
                initializer.span(),
                component_scope_id,
                &analysis,
                ctx,
            ) || static_value_binding_only_has_scalar_lookups(binding.symbol_id(), ctx)
                || static_value_binding_is_mutated(binding.symbol_id(), component_node, ctx)
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`{}` inside `{component_name}` uses no local state but is rebuilt every render, so it looks new each time & breaks memoized children. Move it to the top of the file, outside the component.",
                    binding.name
                ))
                .with_label(declarator.span),
            );
        }
    }
}

fn static_value_build_analysis(ctx: &LintContext<'_>) -> StaticValueAnalysis {
    let mut analysis = StaticValueAnalysis::default();
    for node in ctx.nodes().iter() {
        if let AstKind::VariableDeclarator(declarator) = node.kind()
            && declarator.id.get_binding_identifier().is_some()
            && declarator.init.as_ref().is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::ArrayExpression(_) | Expression::ObjectExpression(_)
                )
            })
        {
            analysis.candidate_ids.push(node.id());
        }
        match node.kind() {
            AstKind::ArrowFunctionExpression(function)
                if function.get_expression().is_some_and(|expression| {
                    matches!(
                        static_value_unwrap_factory_return(expression),
                        Expression::ObjectExpression(_)
                    )
                }) =>
            {
                analysis.object_returning_function_ids.insert(node.id());
            }
            AstKind::ReturnStatement(statement)
                if statement.argument.as_ref().is_some_and(|argument| {
                    matches!(
                        static_value_unwrap_factory_return(argument),
                        Expression::ObjectExpression(_)
                    )
                }) =>
            {
                if let Some(owner) = crate::ast_util::get_enclosing_function(node, ctx) {
                    analysis.object_returning_function_ids.insert(owner.id());
                }
            }
            _ => {}
        }
        if matches!(
            node.kind(),
            AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
                | AstKind::IdentifierReference(_)
                | AstKind::JSXOpeningElement(_)
                | AstKind::CallExpression(_)
                | AstKind::NewExpression(_)
        ) {
            analysis.initializer_node_ids.push(node.id());
        }
    }
    analysis
        .candidate_ids
        .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
    analysis
        .initializer_node_ids
        .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
    analysis
}

fn static_value_unwrap_factory_return<'a>(
    mut expression: &'a Expression<'a>,
) -> &'a Expression<'a> {
    loop {
        expression = match expression {
            Expression::TSAsExpression(wrapper) => &wrapper.expression,
            Expression::TSSatisfiesExpression(wrapper) => &wrapper.expression,
            Expression::TSNonNullExpression(wrapper) => &wrapper.expression,
            _ => return expression,
        };
    }
}

fn static_value_enclosing_component<'a, 'b>(
    candidate_node: &'b AstNode<'a>,
    analysis: &StaticValueAnalysis,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b AstNode<'a>, &'b str, ScopeId)> {
    let component_node = crate::ast_util::get_enclosing_function(candidate_node, ctx)?;
    let component_name = static_value_component_or_hook_name(component_node, ctx)?;
    if !crate::utils::is_react_hook_name(component_name)
        && analysis
            .object_returning_function_ids
            .contains(&component_node.id())
    {
        return None;
    }
    let component_scope_id = match component_node.kind() {
        AstKind::Function(function) => function.scope_id.get(),
        AstKind::ArrowFunctionExpression(function) => function.scope_id.get(),
        _ => None,
    }?;
    Some((component_node, component_name, component_scope_id))
}

fn static_value_component_or_hook_name<'a, 'b>(
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
        return crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
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
            || !static_value_hoc_callee_name(&call.callee)
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
                && crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
        })
        .map(|identifier| identifier.name.as_str())
}

fn static_value_hoc_callee_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
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

fn static_value_initializer_is_unsafe<'a>(
    initializer_span: Span,
    component_scope_id: ScopeId,
    analysis: &StaticValueAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let first_node_index = analysis.initializer_node_ids.partition_point(|node_id| {
        ctx.nodes().get_node(*node_id).span().start < initializer_span.start
    });
    for node_id in &analysis.initializer_node_ids[first_node_index..] {
        let node = ctx.nodes().get_node(*node_id);
        if node.span().start > initializer_span.end {
            break;
        }
        if !initializer_span.contains_inclusive(node.span()) {
            continue;
        }
        match node.kind() {
            AstKind::Function(function) if function.r#type == FunctionType::FunctionExpression => {
                return true;
            }
            AstKind::ArrowFunctionExpression(_) => return true,
            AstKind::IdentifierReference(identifier) => {
                let reference = ctx.scoping().get_reference(identifier.reference_id());
                if reference.is_type() {
                    continue;
                }
                if reference.symbol_id().is_some_and(|symbol_id| {
                    static_value_symbol_is_component_local(symbol_id, component_scope_id, ctx)
                }) {
                    return true;
                }
            }
            AstKind::JSXOpeningElement(opening_element) => {
                if static_value_jsx_root_symbol_id(opening_element, ctx).is_some_and(|symbol_id| {
                    static_value_symbol_is_component_local(symbol_id, component_scope_id, ctx)
                }) {
                    return true;
                }
            }
            AstKind::CallExpression(_) | AstKind::NewExpression(_)
                if static_value_node_is_impure(node, ctx) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn static_value_symbol_is_component_local<'a>(
    symbol_id: SymbolId,
    component_scope_id: ScopeId,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .scope_ancestors(ctx.scoping().symbol_scope_id(symbol_id))
        .any(|scope_id| scope_id == component_scope_id)
}

fn static_value_jsx_root_symbol_id<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let identifier = match &opening_element.name {
        JSXElementName::IdentifierReference(identifier) => identifier,
        JSXElementName::MemberExpression(member) => static_value_jsx_member_root(member)?,
        _ => return None,
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn static_value_jsx_member_root<'a>(
    member: &'a JSXMemberExpression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => Some(identifier),
        JSXMemberExpressionObject::MemberExpression(parent) => static_value_jsx_member_root(parent),
        JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}

fn static_value_node_is_impure<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    match node.kind() {
        AstKind::NewExpression(expression) => {
            matches!(&expression.callee, Expression::Identifier(identifier) if identifier.name == "Date")
        }
        AstKind::CallExpression(call) => match &call.callee {
            Expression::Identifier(identifier) => {
                IMPURE_BARE_CALL_NAMES.contains(&identifier.name.as_str())
                    && static_value_bare_callee_is_external(identifier, ctx)
            }
            Expression::StaticMemberExpression(member) => {
                let property_name = member.property.name.as_str();
                match property_name {
                    "random" => is_proven_global_namespace_reference(&member.object, "Math", ctx),
                    "now" => {
                        is_proven_global_namespace_reference(&member.object, "Date", ctx)
                            || is_proven_global_namespace_reference(
                                &member.object,
                                "performance",
                                ctx,
                            )
                    }
                    "randomUUID" | "getRandomValues" | "randomBytes" => {
                        is_proven_global_namespace_reference(&member.object, "crypto", ctx)
                            || static_value_is_node_crypto_namespace(&member.object, ctx)
                    }
                    _ => false,
                }
            }
            _ => false,
        },
        _ => false,
    }
}

fn static_value_bare_callee_is_external<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    static_value_symbol_is_imported_from(symbol_id, &[], ctx)
}

fn static_value_is_node_crypto_namespace<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    if static_value_symbol_is_imported_from(symbol_id, &NODE_CRYPTO_MODULE_SOURCES, ctx) {
        return true;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .init
        .as_ref()
        .is_some_and(static_value_is_node_crypto_require)
}

fn static_value_symbol_is_imported_from<'a>(
    symbol_id: SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        ctx.scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
            && (module_sources.is_empty() || module_sources.contains(&entry.module_request.name()))
    })
}

fn static_value_is_node_crypto_require(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return static_value_is_node_crypto_require(member.object());
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    if callee.name != "require" {
        return false;
    }
    call.arguments
        .first()
        .and_then(|argument| argument.as_expression())
        .is_some_and(|argument| {
            matches!(argument.get_inner_expression(), Expression::StringLiteral(source)
                if NODE_CRYPTO_MODULE_SOURCES.contains(&source.value.as_str()))
        })
}

fn static_value_binding_only_has_scalar_lookups<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut lookup_count = 0;
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if reference.is_type() {
            continue;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let member_node = ctx.nodes().parent_node(reference_node.id());
        let AstKind::StaticMemberExpression(member) = member_node.kind() else {
            return false;
        };
        if member.object.span() != reference_node.span()
            || !SCALAR_LOOKUP_METHOD_NAMES.contains(&member.property.name.as_str())
        {
            return false;
        }
        let call_node = ctx.nodes().parent_node(member_node.id());
        let AstKind::CallExpression(call) = call_node.kind() else {
            return false;
        };
        if call.callee.span() != member_node.span() {
            return false;
        }
        lookup_count += 1;
    }
    lookup_count > 0
}

fn static_value_binding_is_mutated<'a>(
    symbol_id: SymbolId,
    component_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let component_span = component_node.span();
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_type())
        .map(|reference| ctx.nodes().get_node(reference.node_id()))
        .filter(|reference_node| component_span.contains_inclusive(reference_node.span()))
        .any(|reference_node| static_value_reference_is_mutated(reference_node, ctx))
}

fn static_value_reference_is_mutated<'a>(
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut mutation_target = reference_node;
    let mut receiver_method_name = None;
    loop {
        mutation_target = transparent_expression_root(mutation_target, ctx);
        let parent = ctx.nodes().parent_node(mutation_target.id());
        let member_property_name = match parent.kind() {
            AstKind::StaticMemberExpression(member)
                if member.object.span() == mutation_target.span() =>
            {
                Some(Some(member.property.name.to_string()))
            }
            AstKind::ComputedMemberExpression(member)
                if member.object.span() == mutation_target.span() =>
            {
                Some(member.static_property_name().map(|name| name.to_string()))
            }
            AstKind::PrivateFieldExpression(member)
                if member.object.span() == mutation_target.span() =>
            {
                Some(None)
            }
            _ => None,
        };
        if let Some(property_name) = member_property_name {
            receiver_method_name = property_name;
            mutation_target = parent;
            continue;
        }
        return match parent.kind() {
            AstKind::AssignmentExpression(assignment) => {
                assignment.left.span() == mutation_target.span()
            }
            AstKind::UpdateExpression(update) => update.argument.span() == mutation_target.span(),
            AstKind::UnaryExpression(unary) => {
                unary.operator == UnaryOperator::Delete
                    && unary.argument.span() == mutation_target.span()
            }
            AstKind::CallExpression(call) => {
                call.callee.span() == mutation_target.span()
                    && receiver_method_name.as_deref().is_some_and(|method_name| {
                        MUTATING_RECEIVER_METHOD_NAMES.contains(&method_name)
                    })
            }
            _ => false,
        };
    }
}
