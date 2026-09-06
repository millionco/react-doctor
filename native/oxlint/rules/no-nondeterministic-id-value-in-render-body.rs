use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::{
    node::NodeId,
    operator::{BinaryOperator, LogicalOperator},
};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, module_record::ImportImportName, rule::Rule};

const GENERATOR_MESSAGE: &str = "This id generator runs on every render, so the id changes each render and its htmlFor/aria/SVG reference stops matching (and mismatches during SSR). Use useId for reference ids, or a useRef/useState initializer to mint it once.";
const USE_MEMO_MESSAGE: &str = "useMemo does not guarantee a stable value (React may recompute it), so this id can change mid-session and break its reference. Mint it once with useRef or a useState initializer instead.";
const IDENTITY_SINK_ATTRIBUTE_NAMES: [&str; 10] = [
    "id",
    "htmlFor",
    "aria-activedescendant",
    "aria-controls",
    "aria-describedby",
    "aria-details",
    "aria-errormessage",
    "aria-flowto",
    "aria-labelledby",
    "aria-owns",
];
const ID_GENERATOR_IMPORT_SOURCES: [&str; 5] = [
    "lodash",
    "lodash/uniqueId",
    "lodash.uniqueid",
    "nanoid",
    "shortid",
];

#[derive(Debug, Default, Clone)]
pub struct NoNondeterministicIdValueInRenderBody;

declare_oxc_lint!(
    /// Disallow nondeterministic identity-reference values created during render.
    NoNondeterministicIdValueInRenderBody,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Nondeterministic id generated in render body.",
);

impl Rule for NoNondeterministicIdValueInRenderBody {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let returned_expressions_by_function =
            nondeterministic_id_returned_expressions_by_function(ctx);
        let import_entries_by_symbol = ctx
            .module_record()
            .import_entries
            .iter()
            .filter_map(|entry| {
                ctx.scoping()
                    .get_root_binding(entry.local_name.name().into())
                    .map(|symbol_id| (symbol_id, entry))
            })
            .collect::<FxHashMap<_, _>>();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    if nondeterministic_id_is_impure_generator_call(
                        call_expression,
                        &import_entries_by_symbol,
                        ctx,
                    ) {
                        nondeterministic_id_check_inline_call(node, call_expression.span, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(binding_identifier) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let Some(enclosing_function) =
                        crate::ast_util::get_enclosing_function(node, ctx)
                    else {
                        continue;
                    };
                    if component_or_hook_function_name(enclosing_function, ctx).is_none() {
                        continue;
                    }

                    if nondeterministic_id_is_use_memo_impure_generator(
                        initializer,
                        &returned_expressions_by_function,
                        &import_entries_by_symbol,
                        ctx,
                    ) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(USE_MEMO_MESSAGE).with_label(initializer.span()),
                        );
                    } else if nondeterministic_id_expression_contains_impure_generator(
                        initializer,
                        &import_entries_by_symbol,
                        ctx,
                    ) && nondeterministic_id_binding_flows_to_identity_sink(
                        enclosing_function,
                        binding_identifier.symbol_id(),
                        ctx,
                    ) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(GENERATOR_MESSAGE).with_label(initializer.span()),
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

fn nondeterministic_id_check_inline_call<'a>(
    call_node: &AstNode<'a>,
    call_span: Span,
    ctx: &LintContext<'a>,
) {
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(call_node, ctx) else {
        return;
    };
    if component_or_hook_function_name(enclosing_function, ctx).is_none() {
        return;
    }
    let Some(attribute) = ctx
        .nodes()
        .ancestors(call_node.id())
        .take_while(|ancestor| ancestor.id() != enclosing_function.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::JSXAttribute(_)))
    else {
        return;
    };
    let AstKind::JSXAttribute(attribute_node) = attribute.kind() else {
        return;
    };
    if nondeterministic_id_is_identity_sink_attribute(attribute_node)
        && !nondeterministic_id_is_inside_markup_serialization(attribute, enclosing_function, ctx)
    {
        ctx.diagnostic(OxcDiagnostic::warn(GENERATOR_MESSAGE).with_label(call_span));
    }
}

fn nondeterministic_id_returned_expressions_by_function<'a, 'b>(
    ctx: &'b LintContext<'a>,
) -> FxHashMap<NodeId, Vec<&'b Expression<'a>>> {
    let mut returned_expressions_by_function = FxHashMap::default();
    for node in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = node.kind() else {
            continue;
        };
        let Some(argument) = &return_statement.argument else {
            continue;
        };
        let Some(function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
            continue;
        };
        returned_expressions_by_function
            .entry(function_node.id())
            .or_insert_with(Vec::new)
            .push(argument);
    }
    returned_expressions_by_function
}

fn nondeterministic_id_is_use_memo_impure_generator<'a>(
    expression: &Expression<'a>,
    returned_expressions_by_function: &FxHashMap<NodeId, Vec<&Expression<'a>>>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &crate::module_record::ImportEntry>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    if !is_react_hook_call(call_expression, &["useMemo"], ctx) {
        return false;
    }
    let Some(callback) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(dependencies) = call_expression
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::ArrayExpression(dependency_array) = dependencies else {
        return false;
    };
    if !dependency_array.elements.is_empty() {
        return false;
    }

    match callback {
        Expression::ArrowFunctionExpression(arrow_function) => {
            if let Some(returned_expression) = arrow_function.get_expression() {
                return nondeterministic_id_expression_contains_impure_generator(
                    returned_expression,
                    import_entries_by_symbol,
                    ctx,
                );
            }
            returned_expressions_by_function
                .get(&arrow_function.node_id.get())
                .is_some_and(|returned_expressions| {
                    returned_expressions.iter().any(|returned_expression| {
                        nondeterministic_id_expression_contains_impure_generator(
                            returned_expression,
                            import_entries_by_symbol,
                            ctx,
                        )
                    })
                })
        }
        Expression::FunctionExpression(function) => returned_expressions_by_function
            .get(&function.node_id.get())
            .is_some_and(|returned_expressions| {
                returned_expressions.iter().any(|returned_expression| {
                    nondeterministic_id_expression_contains_impure_generator(
                        returned_expression,
                        import_entries_by_symbol,
                        ctx,
                    )
                })
            }),
        _ => false,
    }
}

fn nondeterministic_id_expression_contains_impure_generator<'a>(
    expression: &Expression<'a>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &crate::module_record::ImportEntry>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression
        && nondeterministic_id_is_impure_generator_call(
            call_expression,
            import_entries_by_symbol,
            ctx,
        )
    {
        return true;
    }
    match expression {
        Expression::LogicalExpression(logical_expression)
            if matches!(
                logical_expression.operator,
                LogicalOperator::Or | LogicalOperator::And | LogicalOperator::Coalesce
            ) =>
        {
            nondeterministic_id_expression_contains_impure_generator(
                &logical_expression.left,
                import_entries_by_symbol,
                ctx,
            ) || nondeterministic_id_expression_contains_impure_generator(
                &logical_expression.right,
                import_entries_by_symbol,
                ctx,
            )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            nondeterministic_id_expression_contains_impure_generator(
                &conditional_expression.consequent,
                import_entries_by_symbol,
                ctx,
            ) || nondeterministic_id_expression_contains_impure_generator(
                &conditional_expression.alternate,
                import_entries_by_symbol,
                ctx,
            )
        }
        Expression::TemplateLiteral(template_literal) => {
            template_literal
                .expressions
                .iter()
                .any(|embedded_expression| {
                    nondeterministic_id_expression_contains_impure_generator(
                        embedded_expression,
                        import_entries_by_symbol,
                        ctx,
                    )
                })
        }
        Expression::BinaryExpression(binary_expression)
            if binary_expression.operator == BinaryOperator::Addition =>
        {
            nondeterministic_id_expression_contains_impure_generator(
                &binary_expression.left,
                import_entries_by_symbol,
                ctx,
            ) || nondeterministic_id_expression_contains_impure_generator(
                &binary_expression.right,
                import_entries_by_symbol,
                ctx,
            )
        }
        _ => false,
    }
}

fn nondeterministic_id_is_impure_generator_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &crate::module_record::ImportEntry>,
    ctx: &LintContext<'a>,
) -> bool {
    match &call_expression.callee {
        Expression::Identifier(identifier) => nondeterministic_id_is_imported_generator_function(
            identifier,
            import_entries_by_symbol,
            ctx,
        ),
        expression => {
            let Some(member_expression) = expression.as_member_expression() else {
                return false;
            };
            let Some(property_name) = member_expression.static_property_name() else {
                return false;
            };
            let Expression::Identifier(receiver) = member_expression.object() else {
                return false;
            };
            match property_name {
                "randomUUID" => {
                    receiver.name == "crypto"
                        && nondeterministic_id_is_known_library_reference(
                            receiver,
                            import_entries_by_symbol,
                            ctx,
                        )
                }
                "uniqueId" => nondeterministic_id_is_known_library_reference(
                    receiver,
                    import_entries_by_symbol,
                    ctx,
                ),
                "nanoid" => nondeterministic_id_import_for_reference(
                    receiver,
                    import_entries_by_symbol,
                    ctx,
                )
                .is_some_and(|entry| {
                    entry.module_request.name() == "nanoid"
                        && matches!(entry.import_name, ImportImportName::NamespaceObject)
                }),
                "generate" => {
                    receiver.name == "shortid"
                        && nondeterministic_id_is_known_library_reference(
                            receiver,
                            import_entries_by_symbol,
                            ctx,
                        )
                }
                _ => false,
            }
        }
    }
}

fn nondeterministic_id_is_imported_generator_function<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &crate::module_record::ImportEntry>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(import_entry) =
        nondeterministic_id_import_for_reference(identifier, import_entries_by_symbol, ctx)
    else {
        return false;
    };
    let exported_name = match &import_entry.import_name {
        ImportImportName::Default(_) => Some("default"),
        ImportImportName::Name(imported_name) => Some(imported_name.name()),
        ImportImportName::NamespaceObject => None,
    };
    match import_entry.module_request.name() {
        "nanoid" => matches!(exported_name, Some("nanoid" | "default")),
        "lodash" | "lodash/uniqueId" | "lodash.uniqueid" => {
            matches!(exported_name, Some("uniqueId" | "default"))
        }
        "shortid" => exported_name == Some("default"),
        _ => false,
    }
}

fn nondeterministic_id_is_known_library_reference<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &crate::module_record::ImportEntry>,
    ctx: &LintContext<'a>,
) -> bool {
    if identifier.name == "crypto"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
    {
        return true;
    }
    nondeterministic_id_import_for_reference(identifier, import_entries_by_symbol, ctx)
        .is_some_and(|entry| ID_GENERATOR_IMPORT_SOURCES.contains(&entry.module_request.name()))
}

fn nondeterministic_id_import_for_reference<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    import_entries_by_symbol: &'b FxHashMap<SymbolId, &'b crate::module_record::ImportEntry>,
    ctx: &LintContext<'a>,
) -> Option<&'b crate::module_record::ImportEntry> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    import_entries_by_symbol.get(&symbol_id).copied()
}

fn nondeterministic_id_binding_flows_to_identity_sink<'a>(
    function_node: &AstNode<'a>,
    initial_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut pending_symbol_ids = vec![initial_symbol_id];
    let mut visited_symbol_ids = FxHashSet::default();
    while let Some(symbol_id) = pending_symbol_ids.pop() {
        if !visited_symbol_ids.insert(symbol_id) {
            continue;
        }
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if let Some(attribute) = ctx
                .nodes()
                .ancestors(reference_node.id())
                .take_while(|ancestor| ancestor.id() != function_node.id())
                .find(|ancestor| matches!(ancestor.kind(), AstKind::JSXAttribute(_)))
                && let AstKind::JSXAttribute(attribute_node) = attribute.kind()
                && nondeterministic_id_is_identity_sink_attribute(attribute_node)
                && !nondeterministic_id_is_inside_markup_serialization(
                    attribute,
                    function_node,
                    ctx,
                )
            {
                return true;
            }

            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
            {
                continue;
            }
            if let Some(alias_identifier) = declarator.id.get_binding_identifier() {
                pending_symbol_ids.push(alias_identifier.symbol_id());
            }
        }
    }
    false
}

fn nondeterministic_id_is_identity_sink_attribute(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
) -> bool {
    matches!(
        &attribute.name,
        JSXAttributeName::Identifier(identifier)
            if IDENTITY_SINK_ATTRIBUTE_NAMES.contains(&identifier.name.as_str())
    )
}

fn nondeterministic_id_is_inside_markup_serialization<'a>(
    attribute: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes()
        .ancestors(attribute.id())
        .take_while(|ancestor| ancestor.id() != function_node.id())
        .any(|ancestor| {
            let AstKind::CallExpression(call_expression) = ancestor.kind() else {
                return false;
            };
            matches!(
                nondeterministic_id_callee_name(&call_expression.callee),
                Some("renderToStaticMarkup" | "renderToString")
            )
        })
}

fn nondeterministic_id_callee_name<'a>(expression: &'a Expression<'_>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        _ => None,
    }
}
