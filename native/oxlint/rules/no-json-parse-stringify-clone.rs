use oxc_ast::{
    AstKind,
    ast::{
        Argument, CallExpression, Expression, ObjectProperty, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::LintContext,
    module_record::ExportExportName,
    rule::Rule,
};

const MESSAGE: &str = "`JSON.parse(JSON.stringify(x))` deep-clones by re-serializing: it is slow on large objects and silently drops `undefined`, functions, `Date`/`Map`/`Set`, and cyclic references. Use `structuredClone(x)`.";
const NEXTJS_PAGE_DATA_EXPORT_NAMES: [&str; 2] = ["getServerSideProps", "getStaticProps"];

#[derive(Debug, Default, Clone)]
pub struct NoJsonParseStringifyClone;

declare_oxc_lint!(
    /// Disallow JSON parse/stringify deep cloning.
    NoJsonParseStringifyClone,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow JSON parse/stringify deep cloning.",
);

impl Rule for NoJsonParseStringifyClone {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(parse_call) = node.kind() else {
            return;
        };
        if !is_json_method_call(parse_call, "parse") {
            return;
        }
        let Some(Expression::CallExpression(stringify_call)) = parse_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if !is_json_method_call(stringify_call, "stringify") {
            return;
        }
        if stringify_call
            .arguments
            .get(1)
            .is_some_and(is_inline_function_or_array_argument)
            || parse_call
                .arguments
                .get(1)
                .is_some_and(is_inline_function_argument)
            || is_inside_snapshot_helper(node, ctx)
            || is_assigned_to_normalization_binding(node, ctx)
            || is_catch_parameter_round_trip(stringify_call, node, ctx)
            || is_used_to_serialize_nextjs_page_props(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(parse_call.span));
    }
}

fn is_json_method_call(call: &CallExpression<'_>, method_name: &str) -> bool {
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return false;
    };
    matches!(
        member.object.get_inner_expression(),
        Expression::Identifier(receiver)
            if receiver.name == "JSON" && member.property.name == method_name
    )
}

fn is_inline_function_argument(argument: &Argument<'_>) -> bool {
    matches!(
        argument,
        Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_)
    )
}

fn is_inline_function_or_array_argument(argument: &Argument<'_>) -> bool {
    is_inline_function_argument(argument) || matches!(argument, Argument::ArrayExpression(_))
}

fn is_assigned_to_normalization_binding(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    let Some(identifier) = declarator.id.get_binding_identifier() else {
        return false;
    };
    let binding_name = identifier.name.to_ascii_lowercase();
    binding_name.contains("normaliz") || binding_name.contains("normalis")
}

fn is_catch_parameter_round_trip<'a>(
    stringify_call: &CallExpression<'a>,
    stringify_parent: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(Argument::Identifier(argument)) = stringify_call.arguments.first() else {
        return false;
    };
    for ancestor in ctx.nodes().ancestors(stringify_parent.id()) {
        match ancestor.kind() {
            AstKind::Function(function)
                if function.params.items.iter().any(|parameter| {
                    parameter
                        .pattern
                        .get_binding_identifier()
                        .is_some_and(|identifier| identifier.name == argument.name)
                }) =>
            {
                return false;
            }
            AstKind::ArrowFunctionExpression(function)
                if function.params.items.iter().any(|parameter| {
                    parameter
                        .pattern
                        .get_binding_identifier()
                        .is_some_and(|identifier| identifier.name == argument.name)
                }) =>
            {
                return false;
            }
            AstKind::CatchClause(catch_clause)
                if catch_clause
                    .param
                    .as_ref()
                    .and_then(|parameter| parameter.pattern.get_binding_identifier())
                    .is_some_and(|identifier| identifier.name == argument.name) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn is_inside_snapshot_helper<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let Some(function_name) = function_name(ancestor, ctx) else {
            continue;
        };
        return is_snapshot_function_name(function_name)
            && !function_name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase);
    }
    false
}

fn function_name<'a, 'ctx>(
    function_node: &'ctx AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx str> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.name.as_str());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.name.as_str()),
        AstKind::ObjectProperty(property) => property_key_identifier_name(&property.key),
        AstKind::MethodDefinition(method) => property_key_identifier_name(&method.key),
        _ => None,
    }
}

fn is_snapshot_function_name(name: &str) -> bool {
    let lower_name = name.to_ascii_lowercase();
    ["snapshot", "serializ", "tojson", "jsonsafe"]
        .iter()
        .any(|part| lower_name.contains(part))
}

fn is_used_to_serialize_nextjs_page_props<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !is_in_project_directory(ctx, "pages") || is_in_project_directory(ctx, "pages/api") {
        return false;
    }
    let Some(page_data_function_id) = enclosing_nextjs_page_data_function(node, ctx) else {
        return false;
    };
    if is_inside_returned_nextjs_props(node, page_data_function_id, ctx) {
        return true;
    }
    let Some(binding_symbol_id) = find_page_data_result_binding(node, ctx) else {
        return false;
    };
    let alias_symbol_ids = collect_const_alias_symbols(binding_symbol_id, ctx);
    let alias_symbol_id_set = alias_symbol_ids.iter().copied().collect::<FxHashSet<_>>();
    let mut has_page_props_reference = false;
    for alias_symbol_id in alias_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(alias_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if nearest_function_node_id(reference_node, ctx) != Some(page_data_function_id) {
                return false;
            }
            if is_inside_returned_nextjs_props(reference_node, page_data_function_id, ctx) {
                has_page_props_reference = true;
                continue;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let declarator_node = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                return false;
            };
            let Some(alias_binding) = declarator.id.get_binding_identifier() else {
                return false;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
                || !alias_symbol_id_set.contains(&alias_binding.symbol_id())
            {
                return false;
            }
        }
    }
    has_page_props_reference
}

fn enclosing_nextjs_page_data_function(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let mut outermost_function_id = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            outermost_function_id = Some(ancestor.id());
        }
    }
    let function_id = outermost_function_id?;
    let function_span = ctx.nodes().get_node(function_id).span();
    NEXTJS_PAGE_DATA_EXPORT_NAMES
        .iter()
        .any(|export_name| exported_value_contains_span(export_name, function_span, ctx))
        .then_some(function_id)
}

fn exported_value_contains_span(
    exported_name: &str,
    contained_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let local_name = ctx
        .module_record()
        .local_export_entries
        .iter()
        .find_map(|entry| {
            if entry.is_type {
                return None;
            }
            let does_name_match = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) | ExportExportName::Null => false,
            };
            does_name_match.then(|| entry.local_name.name()).flatten()
        });
    let Some(symbol_id) = local_name.and_then(|name| ctx.scoping().get_root_binding(name.into()))
    else {
        return false;
    };
    ctx.symbol_declaration(symbol_id)
        .span()
        .contains_inclusive(contained_span)
}

#[derive(Clone, Copy)]
struct ConditionalExpressionRoot<'a, 'ctx> {
    node: &'ctx AstNode<'a>,
    expression_span: Span,
}

fn conditional_expression_root<'a, 'ctx>(
    node: &'ctx AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> ConditionalExpressionRoot<'a, 'ctx> {
    let mut root = transparent_expression_root(node, ctx);
    let mut expression_span = node.span();
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        let AstKind::ConditionalExpression(conditional) = parent.kind() else {
            return ConditionalExpressionRoot {
                node: root,
                expression_span,
            };
        };
        if conditional.consequent.span() != root.span()
            && conditional.alternate.span() != root.span()
        {
            return ConditionalExpressionRoot {
                node: root,
                expression_span,
            };
        }
        expression_span = conditional.span;
        root = transparent_expression_root(parent, ctx);
    }
}

fn is_inside_returned_nextjs_props<'a>(
    node: &AstNode<'a>,
    page_data_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == page_data_function_id {
            break;
        }
        let AstKind::ObjectProperty(property) = ancestor.kind() else {
            continue;
        };
        if property.key.static_name().as_deref() != Some("props")
            || !is_value_forwarded_to_property_value(node, property, ctx)
        {
            continue;
        }
        let property_container = ctx.nodes().parent_node(ancestor.id());
        let return_expression = conditional_expression_root(property_container, ctx);
        let return_parent = ctx.nodes().parent_node(return_expression.node.id());
        if matches!(
            return_parent.kind(),
            AstKind::ReturnStatement(statement)
                if statement.argument.as_ref().is_some_and(|argument| argument.span() == return_expression.node.span())
                    && nearest_function_node_id(return_parent, ctx) == Some(page_data_function_id)
        ) || matches!(
            ctx.nodes().get_node(page_data_function_id).kind(),
            AstKind::ArrowFunctionExpression(function)
                if function.get_expression().is_some_and(|expression| expression.get_inner_expression().span() == return_expression.expression_span)
        ) || is_returned_page_data_result_binding(return_expression, page_data_function_id, ctx)
        {
            return true;
        }
    }
    false
}

fn is_returned_page_data_result_binding(
    return_expression: ConditionalExpressionRoot<'_, '_>,
    page_data_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declarator_node = ctx.nodes().parent_node(return_expression.node.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return false;
    };
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != return_expression.node.span())
        || nearest_function_node_id(declarator_node, ctx) != Some(page_data_function_id)
    {
        return false;
    }
    let mut references = ctx.scoping().get_resolved_references(binding.symbol_id());
    let Some(reference) = references.next() else {
        return false;
    };
    if references.next().is_some() {
        return false;
    }
    let reference_node = ctx.nodes().get_node(reference.node_id());
    let reference_root = transparent_expression_root(reference_node, ctx);
    let return_statement = ctx.nodes().parent_node(reference_root.id());
    matches!(
        return_statement.kind(),
        AstKind::ReturnStatement(statement)
            if statement.argument.as_ref().is_some_and(|argument| argument.span() == reference_root.span())
                && nearest_function_node_id(return_statement, ctx) == Some(page_data_function_id)
    )
}

fn is_value_forwarded_to_property_value<'a>(
    node: &AstNode<'a>,
    property: &ObjectProperty<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let direct_value = conditional_expression_root(node, ctx);
    is_value_forwarded_through_literal_structure(direct_value.expression_span, &property.value)
        || property.shorthand
            && (property.key.span() == direct_value.expression_span
                || property.value.span() == direct_value.expression_span)
}

fn is_value_forwarded_through_literal_structure(
    forwarded_span: Span,
    structure: &Expression<'_>,
) -> bool {
    let structure = structure.get_inner_expression();
    if structure.span() == forwarded_span {
        return true;
    }
    match structure {
        Expression::ConditionalExpression(conditional) => {
            is_value_forwarded_through_literal_structure(forwarded_span, &conditional.consequent)
                || is_value_forwarded_through_literal_structure(
                    forwarded_span,
                    &conditional.alternate,
                )
        }
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| {
            element.as_expression().is_some_and(|expression| {
                is_value_forwarded_through_literal_structure(forwarded_span, expression)
            })
        }),
        Expression::ObjectExpression(object) => object.properties.iter().any(|property| {
            match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    is_value_forwarded_through_literal_structure(forwarded_span, &spread.argument)
                }
                ObjectPropertyKind::ObjectProperty(property) => {
                    is_value_forwarded_through_literal_structure(forwarded_span, &property.value)
                        || property.shorthand
                            && (property.key.span() == forwarded_span
                                || property.value.span() == forwarded_span)
                }
            }
        }),
        _ => false,
    }
}

fn find_page_data_result_binding<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::VariableDeclarator(declarator) = ancestor.kind() else {
            continue;
        };
        let initializer = declarator.init.as_ref()?;
        let binding = declarator.id.get_binding_identifier()?;
        return is_value_forwarded_to_binding_initializer(node, initializer, ctx)
            .then(|| binding.symbol_id());
    }
    None
}

fn is_value_forwarded_to_binding_initializer<'a>(
    node: &AstNode<'a>,
    initializer: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let direct_value = conditional_expression_root(node, ctx);
    if is_value_forwarded_through_literal_structure(direct_value.expression_span, initializer) {
        return true;
    }
    let Expression::CallExpression(call) = initializer.get_inner_expression() else {
        return false;
    };
    let function_expression = call.callee.get_inner_expression();
    let function_node_id = match function_expression {
        Expression::ArrowFunctionExpression(function) => function.node_id.get(),
        Expression::FunctionExpression(function) => function.node_id.get(),
        _ => return false,
    };
    is_expression_returned_by_function(node, function_node_id, ctx)
}

fn is_expression_returned_by_function<'a>(
    node: &AstNode<'a>,
    function_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let return_expression = conditional_expression_root(node, ctx);
    if matches!(
        ctx.nodes().get_node(function_node_id).kind(),
        AstKind::ArrowFunctionExpression(function)
            if function.get_expression().is_some_and(|expression| expression.get_inner_expression().span() == return_expression.expression_span)
    ) {
        return true;
    }
    let return_statement = ctx.nodes().parent_node(return_expression.node.id());
    matches!(
        return_statement.kind(),
        AstKind::ReturnStatement(statement)
            if statement.argument.as_ref().is_some_and(|argument| argument.span() == return_expression.node.span())
                && nearest_function_node_id(return_statement, ctx) == Some(function_node_id)
    )
}

fn collect_const_alias_symbols(
    source_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let mut symbol_ids = vec![source_symbol_id];
    let mut visited_symbol_ids = FxHashSet::from_iter([source_symbol_id]);
    let mut symbol_index = 0;
    while symbol_index < symbol_ids.len() {
        let symbol_id = symbol_ids[symbol_index];
        symbol_index += 1;
        let alias_symbol_ids = ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .filter_map(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                let declarator_node = ctx.nodes().parent_node(reference_root.id());
                let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                    return None;
                };
                if declarator
                    .init
                    .as_ref()
                    .is_none_or(|initializer| initializer.span() != reference_root.span())
                {
                    return None;
                }
                let binding = declarator.id.get_binding_identifier()?;
                let declaration_node = ctx.nodes().parent_node(declarator_node.id());
                let AstKind::VariableDeclaration(declaration) = declaration_node.kind() else {
                    return None;
                };
                declaration.kind.is_const().then(|| binding.symbol_id())
            })
            .collect::<Vec<_>>();
        for alias_symbol_id in alias_symbol_ids {
            if visited_symbol_ids.insert(alias_symbol_id) {
                symbol_ids.push(alias_symbol_id);
            }
        }
    }
    symbol_ids
}

fn nearest_function_node_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}
