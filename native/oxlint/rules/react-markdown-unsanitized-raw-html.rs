use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpressionElement, BindingPattern, Expression, JSXChild, JSXElementName,
        JSXMemberExpressionObject,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_syntax::operator::BinaryOperator;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ImportEntry, ImportImportName},
    rule::Rule,
};

const MESSAGE: &str = "React Markdown parses dynamic raw HTML when `rehype-raw` is enabled. Add `rehype-sanitize` to `rehypePlugins` or sanitize the markdown before rendering it.";
const REACT_MARKDOWN_MODULE: &str = "react-markdown";
const REHYPE_RAW_MODULE: &str = "rehype-raw";
const REHYPE_SANITIZE_MODULE: &str = "rehype-sanitize";

#[derive(Debug, Default, Clone)]
pub struct ReactMarkdownUnsanitizedRawHtml;

declare_oxc_lint!(
    /// Warns when React Markdown parses dynamic raw HTML without sanitization.
    ReactMarkdownUnsanitizedRawHtml,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns about unsanitized raw HTML in React Markdown.",
);

impl Rule for ReactMarkdownUnsanitizedRawHtml {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let opening_element = &element.opening_element;
        if !react_markdown_component_matches(&opening_element.name, ctx) {
            return;
        }
        let Some(plugins_attribute) =
            get_authoritative_jsx_attribute(opening_element, "rehypePlugins", true)
        else {
            return;
        };
        let Some(plugins_expression) = jsx_attribute_expression(plugins_attribute) else {
            return;
        };
        let Some(plugin_entries) =
            collect_rehype_plugin_entries(plugins_expression, ctx, &mut Vec::new())
        else {
            return;
        };
        if !plugin_entries.iter().any(|entry| {
            plugin_expression_matches_module(entry, REHYPE_RAW_MODULE, ctx, &mut Vec::new())
        }) || plugin_entries.iter().any(|entry| {
            plugin_expression_matches_module(entry, REHYPE_SANITIZE_MODULE, ctx, &mut Vec::new())
        }) || !react_markdown_has_dynamic_unsanitized_children(element, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn react_markdown_component_matches<'a>(
    element_name: &JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match element_name {
        JSXElementName::IdentifierReference(identifier) => {
            resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
                entry.module_request.name() == REACT_MARKDOWN_MODULE
                    && (matches!(entry.import_name, ImportImportName::Default(_))
                        || matches!(
                            &entry.import_name,
                            ImportImportName::Name(imported_name)
                                if matches!(
                                    imported_name.name(),
                                    "default" | "MarkdownAsync" | "MarkdownHooks"
                                )
                        ))
            })
        }
        JSXElementName::MemberExpression(member_expression)
            if matches!(
                member_expression.property.name.as_str(),
                "default" | "MarkdownAsync" | "MarkdownHooks"
            ) =>
        {
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
                entry.module_request.name() == REACT_MARKDOWN_MODULE
                    && matches!(entry.import_name, ImportImportName::NamespaceObject)
            })
        }
        _ => false,
    }
}

fn plugin_expression_matches_module<'a>(
    expression: &Expression<'a>,
    module_name: &str,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        if resolve_identifier_import(identifier, ctx)
            .is_some_and(|entry| is_default_import_from_module(entry, module_name))
        {
            return true;
        }
        let Some((symbol_id, initializer)) = exact_const_identifier_initializer(identifier, ctx)
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        return plugin_expression_matches_module(initializer, module_name, ctx, visited_symbol_ids);
    }
    if let Expression::StaticMemberExpression(member_expression) = expression
        && member_expression.property.name == "default"
        && let Expression::Identifier(identifier) = member_expression.object.get_inner_expression()
        && resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
            entry.module_request.name() == module_name
                && matches!(entry.import_name, ImportImportName::NamespaceObject)
        })
    {
        return true;
    }
    let Expression::ArrayExpression(array_expression) = expression else {
        return false;
    };
    array_expression.elements.iter().find_map(|element| {
        let expression = element.as_expression()?;
        Some(plugin_expression_matches_module(
            expression,
            module_name,
            ctx,
            visited_symbol_ids,
        ))
    }) == Some(true)
}

fn is_default_import_from_module(entry: &ImportEntry, module_name: &str) -> bool {
    entry.module_request.name() == module_name
        && (matches!(entry.import_name, ImportImportName::Default(_))
            || matches!(
                &entry.import_name,
                ImportImportName::Name(imported_name) if imported_name.name() == "default"
            ))
}

fn collect_rehype_plugin_entries<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<Vec<&'b Expression<'a>>> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let (symbol_id, initializer) = exact_const_identifier_initializer(identifier, ctx)?;
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        return collect_rehype_plugin_entries(initializer, ctx, visited_symbol_ids);
    }
    let Expression::ArrayExpression(array_expression) = expression else {
        return None;
    };
    let mut entries = Vec::new();
    for element in &array_expression.elements {
        match element {
            ArrayExpressionElement::Elision(_) => {}
            ArrayExpressionElement::SpreadElement(spread_element) => {
                let spread_entries = collect_rehype_plugin_entries(
                    &spread_element.argument,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )?;
                entries.extend(spread_entries);
            }
            element => entries.push(element.as_expression()?),
        }
    }
    Some(entries)
}

fn exact_const_identifier_initializer<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(SymbolId, &'b Expression<'a>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || !matches!(
        &declarator.id,
        BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id
    ) {
        return None;
    }
    Some((symbol_id, declarator.init.as_ref()?))
}

fn react_markdown_has_dynamic_unsanitized_children<'a>(
    element: &oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let meaningful_children = element
        .children
        .iter()
        .filter(|child| !matches!(child, JSXChild::Text(text) if text.value.trim().is_empty()));
    let mut did_find_meaningful_child = false;
    for child in meaningful_children {
        did_find_meaningful_child = true;
        match child {
            JSXChild::Text(_) => {}
            JSXChild::ExpressionContainer(container) => {
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                if !is_static_or_sanitized_markdown_expression(expression, ctx, &mut Vec::new()) {
                    return true;
                }
            }
            JSXChild::Element(_) | JSXChild::Fragment(_) | JSXChild::Spread(_) => return true,
        }
    }
    if did_find_meaningful_child {
        return false;
    }
    get_authoritative_jsx_attribute(&element.opening_element, "children", true)
        .and_then(jsx_attribute_expression)
        .is_some_and(|expression| {
            !is_static_or_sanitized_markdown_expression(expression, ctx, &mut Vec::new())
        })
}

fn is_static_or_sanitized_markdown_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => true,
        Expression::TemplateLiteral(template_literal) => {
            template_literal.expressions.iter().all(|expression| {
                is_static_or_sanitized_markdown_expression(
                    expression,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
            })
        }
        Expression::CallExpression(call_expression) => {
            let Expression::StaticMemberExpression(member_expression) =
                call_expression.callee.get_inner_expression()
            else {
                return false;
            };
            member_expression.property.name == "sanitize"
                && matches!(
                    member_expression.object.get_inner_expression(),
                    Expression::Identifier(identifier)
                        if resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
                            matches!(entry.module_request.name(), "dompurify" | "isomorphic-dompurify")
                                && (matches!(
                                    entry.import_name,
                                    ImportImportName::Default(_) | ImportImportName::NamespaceObject
                                ) || matches!(
                                    &entry.import_name,
                                    ImportImportName::Name(imported_name)
                                        if imported_name.name() == "default"
                                ))
                        })
                )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            is_static_or_sanitized_markdown_expression(
                &conditional_expression.consequent,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) && is_static_or_sanitized_markdown_expression(
                &conditional_expression.alternate,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::BinaryExpression(binary_expression)
            if binary_expression.operator == BinaryOperator::Addition =>
        {
            is_static_or_sanitized_markdown_expression(
                &binary_expression.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) && is_static_or_sanitized_markdown_expression(
                &binary_expression.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) =
                exact_const_identifier_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            is_static_or_sanitized_markdown_expression(initializer, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}
