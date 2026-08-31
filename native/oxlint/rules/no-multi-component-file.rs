use oxc_ast::{
    AstKind,
    ast::{
        Argument, AssignmentTarget, Declaration, ExportDefaultDeclarationKind, Expression,
        JSXChild, JSXElementName, MemberExpression, ModuleExportName, ObjectProperty,
        ObjectPropertyKind, PropertyKey, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{is_es5_component, is_react_component_name},
};

const MESSAGE: &str =
    "This file declares several components, so each component is harder to find, test, and change.";

#[derive(Debug, Default, Clone)]
pub struct NoMultiComponentFile;

#[derive(Clone)]
pub(super) struct MultiComponentCandidate {
    pub(super) span: Span,
    pub(super) body_span: Span,
    pub(super) symbol_id: Option<SymbolId>,
    pub(super) is_stateless: bool,
    pub(super) is_directly_exported: bool,
}

struct MultiComponentJsxEntry {
    span: Span,
    boundary_span: Option<Span>,
}

struct MultiComponentJsxIndex {
    entries: Vec<MultiComponentJsxEntry>,
}

impl MultiComponentJsxIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut entries = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                if !matches!(
                    node.kind(),
                    AstKind::JSXElement(_) | AstKind::JSXFragment(_)
                ) {
                    return None;
                }
                let boundary_span = ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_)
                            | AstKind::ArrowFunctionExpression(_)
                            | AstKind::Class(_)
                    )
                    .then(|| ancestor.span())
                });
                Some(MultiComponentJsxEntry {
                    span: node.span(),
                    boundary_span,
                })
            })
            .collect::<Vec<_>>();
        entries.sort_unstable_by_key(|entry| (entry.span.start, entry.span.end));
        Self { entries }
    }

    fn contains(&self, root_span: Span) -> bool {
        let start = self
            .entries
            .partition_point(|entry| entry.span.start < root_span.start);
        self.entries[start..]
            .iter()
            .take_while(|entry| entry.span.start <= root_span.end)
            .any(|entry| {
                root_span.contains_inclusive(entry.span)
                    && entry.boundary_span.is_none_or(|boundary_span| {
                        boundary_span == root_span || !root_span.contains_inclusive(boundary_span)
                    })
            })
    }
}

declare_oxc_lint!(
    /// Disallow crowded component files while allowing related component modules.
    NoMultiComponentFile,
    react_doctor_native,
    nursery,
    version = "0.1.0",
    short_description = "Disallow crowded component files.",
);

impl Rule for NoMultiComponentFile {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let ignore_stateless = ctx
            .settings()
            .json
            .as_ref()
            .and_then(|settings| settings.get("react-doctor"))
            .and_then(serde_json::Value::as_object)
            .and_then(|settings| settings.get("noMultiComp"))
            .and_then(serde_json::Value::as_object)
            .and_then(|settings| settings.get("ignoreStateless"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let exported_names = multi_component_exported_names(ctx);
        let mut candidates = multi_component_candidates(ctx);
        candidates
            .sort_unstable_by_key(|candidate| (candidate.body_span.start, candidate.body_span.end));
        let mut top_level = Vec::<MultiComponentCandidate>::new();
        for candidate in candidates {
            if top_level.last().is_some_and(|parent| {
                parent.body_span != candidate.body_span
                    && parent.body_span.contains_inclusive(candidate.body_span)
            }) {
                continue;
            }
            top_level.push(candidate);
        }
        if ignore_stateless {
            top_level.retain(|candidate| !candidate.is_stateless);
        }
        if top_level.len() <= 2 {
            return;
        }
        let exported_count = top_level
            .iter()
            .filter(|component| {
                component.is_directly_exported
                    || component.symbol_id.is_some_and(|symbol_id| {
                        exported_names.contains(ctx.scoping().symbol_name(symbol_id))
                    })
            })
            .count();
        let component_count = top_level.len();
        let is_barrel_like = exported_count >= component_count
            || component_count >= 4 && exported_count >= component_count * 7 / 10
            || component_count >= 8 && exported_count >= component_count / 2;
        let is_small_feature =
            exported_count > 0 && exported_count <= 2 && exported_count < component_count;
        let is_large_feature = exported_count > 0
            && exported_count <= 4
            && component_count >= 8
            && exported_count * 2 < component_count;
        let is_very_large_feature = exported_count >= 5
            && component_count >= 12
            && (component_count - exported_count) * 4 >= component_count;
        if is_barrel_like || is_small_feature || is_large_feature || is_very_large_feature {
            return;
        }
        for component in top_level.iter().skip(1) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(component.span));
        }
    }
}

pub(super) fn multi_component_candidates(ctx: &LintContext<'_>) -> Vec<MultiComponentCandidate> {
    let mut candidates = Vec::<MultiComponentCandidate>::new();
    let mut candidate_index_by_body_span = FxHashMap::<(u32, u32), usize>::default();
    let jsx_index = MultiComponentJsxIndex::new(ctx);
    for node in ctx.nodes().iter() {
        let candidate = match node.kind() {
            AstKind::Function(function) => {
                let Some(identifier) = function.id.as_ref() else {
                    continue;
                };
                if !is_react_component_name(&identifier.name)
                    || !jsx_index.contains(function.span)
                    || multi_component_is_passthrough_function(function)
                    || multi_component_is_compound_member_function(node, &jsx_index, ctx)
                {
                    continue;
                }
                Some(MultiComponentCandidate {
                    span: identifier.span,
                    body_span: function.span,
                    symbol_id: Some(identifier.symbol_id()),
                    is_stateless: true,
                    is_directly_exported: multi_component_has_export_ancestor(node, ctx),
                })
            }
            AstKind::VariableDeclarator(declarator) => {
                let Some(identifier) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                if !is_react_component_name(&identifier.name) {
                    continue;
                }
                let Some(initializer) = declarator.init.as_ref() else {
                    continue;
                };
                let Some(body_span) =
                    multi_component_initializer_body_span(initializer, &jsx_index, ctx)
                else {
                    continue;
                };
                let report_span = declarator
                    .type_annotation
                    .as_ref()
                    .map_or(identifier.span, |annotation| {
                        Span::new(identifier.span.start, annotation.span.end)
                    });
                Some(MultiComponentCandidate {
                    span: report_span,
                    body_span,
                    symbol_id: Some(identifier.symbol_id()),
                    is_stateless: true,
                    is_directly_exported: multi_component_has_export_ancestor(node, ctx),
                })
            }
            AstKind::Class(class) => {
                if !multi_component_is_react_class(class) {
                    continue;
                }
                Some(MultiComponentCandidate {
                    span: class
                        .id
                        .as_ref()
                        .map_or(class.span, |identifier| identifier.span),
                    body_span: class.span,
                    symbol_id: class.id.as_ref().map(|identifier| identifier.symbol_id()),
                    is_stateless: false,
                    is_directly_exported: multi_component_has_export_ancestor(node, ctx),
                })
            }
            AstKind::CallExpression(call) if is_es5_component(node) => {
                Some(MultiComponentCandidate {
                    span: call.span,
                    body_span: call.span,
                    symbol_id: None,
                    is_stateless: false,
                    is_directly_exported: multi_component_has_export_ancestor(node, ctx),
                })
            }
            AstKind::ObjectProperty(property) => {
                let Some(name) = multi_component_object_property_name(property) else {
                    continue;
                };
                if !is_react_component_name(&name)
                    || !matches!(
                        &property.value,
                        Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
                    )
                    || !multi_component_contains_jsx(&property.value, &jsx_index)
                {
                    continue;
                }
                Some(MultiComponentCandidate {
                    span: property.key.span(),
                    body_span: property.value.span(),
                    symbol_id: None,
                    is_stateless: true,
                    is_directly_exported: multi_component_has_export_ancestor(node, ctx),
                })
            }
            AstKind::AssignmentExpression(assignment) => {
                let Some((property_span, Some(export_name))) =
                    multi_component_commonjs_export_target(&assignment.left, ctx)
                else {
                    continue;
                };
                if !is_react_component_name(export_name)
                    || !multi_component_contains_jsx(&assignment.right, &jsx_index)
                {
                    continue;
                }
                Some(MultiComponentCandidate {
                    span: property_span,
                    body_span: assignment.right.span(),
                    symbol_id: None,
                    is_stateless: true,
                    is_directly_exported: true,
                })
            }
            AstKind::ExportDefaultDeclaration(declaration) => {
                let candidate_spans = match &declaration.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function)
                        if function.id.is_none() && jsx_index.contains(function.span) =>
                    {
                        Some((function.span, function.span))
                    }
                    ExportDefaultDeclarationKind::ArrowFunctionExpression(function)
                        if jsx_index.contains(function.span) =>
                    {
                        Some((function.span, function.span))
                    }
                    ExportDefaultDeclarationKind::CallExpression(call)
                        if multi_component_is_hoc_component(call, &jsx_index, ctx) =>
                    {
                        Some((declaration.span, call.span))
                    }
                    _ => None,
                };
                candidate_spans.map(|(span, body_span)| MultiComponentCandidate {
                    span,
                    body_span,
                    symbol_id: None,
                    is_stateless: true,
                    is_directly_exported: true,
                })
            }
            _ => None,
        };
        let Some(candidate) = candidate else {
            continue;
        };
        let body_span_key = (candidate.body_span.start, candidate.body_span.end);
        if let Some(&existing_index) = candidate_index_by_body_span.get(&body_span_key) {
            if candidate.span.start < candidates[existing_index].span.start {
                candidates[existing_index] = candidate;
            }
        } else {
            candidate_index_by_body_span.insert(body_span_key, candidates.len());
            candidates.push(candidate);
        }
    }
    candidates
}

fn multi_component_is_compound_member_function(
    function_node: &AstNode<'_>,
    jsx_index: &MultiComponentJsxIndex,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(function_node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let AstKind::AssignmentExpression(assignment) = ancestor.kind() else {
            continue;
        };
        if !assignment
            .right
            .span()
            .contains_inclusive(function_node.span())
        {
            return false;
        }
        let Some(member) = assignment.left.as_member_expression() else {
            return false;
        };
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
        else {
            return false;
        };
        return multi_component_symbol_is_component(symbol_id, jsx_index, ctx);
    }
    false
}

fn multi_component_symbol_is_component(
    symbol_id: SymbolId,
    jsx_index: &MultiComponentJsxIndex,
    ctx: &LintContext<'_>,
) -> bool {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => function.id.as_ref().is_some_and(|identifier| {
            is_react_component_name(&identifier.name) && jsx_index.contains(function.span)
        }),
        AstKind::VariableDeclarator(declarator) => {
            let Some(identifier) = declarator.id.get_binding_identifier() else {
                return false;
            };
            is_react_component_name(&identifier.name)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    multi_component_initializer_body_span(initializer, jsx_index, ctx).is_some()
                })
        }
        AstKind::Class(class) => class.id.as_ref().is_some_and(|identifier| {
            is_react_component_name(&identifier.name) && multi_component_is_react_class(class)
        }),
        _ => false,
    }
}

fn multi_component_initializer_body_span<'a>(
    initializer: &Expression<'a>,
    jsx_index: &MultiComponentJsxIndex,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    let initializer = initializer.get_inner_expression();
    match initializer {
        Expression::ArrowFunctionExpression(function) => {
            (!multi_component_is_passthrough_arrow(function)
                && multi_component_function_expression_is_component(initializer, jsx_index))
            .then_some(function.span)
        }
        Expression::FunctionExpression(function) => {
            (!multi_component_is_passthrough_function(function)
                && multi_component_function_expression_is_component(initializer, jsx_index))
            .then_some(function.span)
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .filter(|expression| {
                multi_component_function_expression_is_component(expression, jsx_index)
            })
            .map(GetSpan::span),
        Expression::CallExpression(call) => {
            multi_component_is_hoc_component(call, jsx_index, ctx).then_some(call.span)
        }
        _ => None,
    }
}

fn multi_component_function_expression_is_component(
    expression: &Expression<'_>,
    jsx_index: &MultiComponentJsxIndex,
) -> bool {
    if multi_component_contains_jsx(expression, jsx_index) {
        return true;
    }
    match expression {
        Expression::ArrowFunctionExpression(function) => {
            function.get_expression().is_some_and(|expression| {
                expression.is_null()
                    || matches!(
                        expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) && multi_component_function_expression_is_component(expression, jsx_index)
            }) || function.get_function_body().is_some_and(|body| {
                body.statements.iter().any(|statement| {
                    matches!(statement, Statement::ReturnStatement(statement)
                            if statement.argument.as_ref().is_some_and(Expression::is_null))
                })
            })
        }
        Expression::FunctionExpression(function) => function.body.as_ref().is_some_and(|body| {
            body.statements.iter().any(|statement| {
                matches!(statement, Statement::ReturnStatement(statement)
                    if statement.argument.as_ref().is_some_and(Expression::is_null))
            })
        }),
        _ => false,
    }
}

fn multi_component_contains_jsx(
    expression: &Expression<'_>,
    jsx_index: &MultiComponentJsxIndex,
) -> bool {
    if matches!(
        expression,
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    ) {
        return true;
    }
    jsx_index.contains(expression.span())
}

fn multi_component_object_property_name<'a>(property: &'a ObjectProperty<'a>) -> Option<&'a str> {
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) if !property.computed => {
            Some(identifier.name.as_str())
        }
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn multi_component_is_hoc_component<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    jsx_index: &MultiComponentJsxIndex,
    ctx: &LintContext<'a>,
) -> bool {
    if !multi_component_is_react_hoc_call(call, ctx) {
        return false;
    }
    call.arguments
        .first()
        .is_some_and(|argument| match argument {
            Argument::FunctionExpression(function) => {
                !multi_component_is_passthrough_function(function)
                    && jsx_index.contains(function.span)
            }
            Argument::ArrowFunctionExpression(function) => {
                !multi_component_is_passthrough_arrow(function) && jsx_index.contains(function.span)
            }
            _ => false,
        })
}

fn multi_component_is_react_hoc_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_react_api_call(call, "memo", ctx)
        || is_react_api_call(call, "forwardRef", ctx)
        || matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if multi_component_symbol_maps_to_hoc(identifier, ctx, &mut FxHashSet::default()))
        || matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "memo" | "forwardRef")
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        || call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                matches!(member.static_property_name(), Some("memo" | "forwardRef"))
                    && multi_component_is_react_namespace_expression(
                        member.object().get_inner_expression(),
                        ctx,
                        &mut FxHashSet::default(),
                    )
            })
}

fn multi_component_symbol_maps_to_hoc(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
            &import_equals.module_reference
        else {
            return false;
        };
        return matches!(
            reference.expression.value.as_str(),
            "react" | "react-dom" | "preact/compat" | "preact/hooks" | "@wordpress/element"
        );
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
        && pattern.properties.iter().any(|property| {
            !property.computed
                && matches!(property.key.static_name().as_deref(), Some("memo" | "forwardRef"))
                && matches!(&property.value, oxc_ast::ast::BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id)
        })
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            multi_component_is_react_namespace_expression(
                initializer.get_inner_expression(),
                ctx,
                visited_symbols,
            )
        });
    }
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    if binding.symbol_id() != symbol_id {
        return false;
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    let initializer = initializer.get_inner_expression();
    if let Expression::Identifier(target) = initializer {
        if ctx
            .scoping()
            .get_reference(target.reference_id())
            .symbol_id()
            .is_none()
        {
            return matches!(target.name.as_str(), "memo" | "forwardRef");
        }
        return multi_component_symbol_maps_to_hoc(target, ctx, visited_symbols);
    }
    initializer.as_member_expression().is_some_and(|member| {
        matches!(member.static_property_name(), Some("memo" | "forwardRef"))
            && multi_component_is_react_namespace_expression(
                member.object().get_inner_expression(),
                ctx,
                visited_symbols,
            )
    })
}

fn multi_component_is_react_namespace_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Expression::CallExpression(call) = expression {
        return multi_component_is_react_require_call(call, ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    if identifier.name == "React" && ctx.is_reference_to_global_variable(identifier) {
        return true;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if ctx.module_record().import_entries.iter().any(|entry| {
        matches!(
            entry.module_request.name(),
            "react" | "react-dom" | "preact/compat" | "preact/hooks" | "@wordpress/element"
        ) && ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Default(_)
                    | crate::module_record::ImportImportName::NamespaceObject
            )
    }) {
        return true;
    }
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
            &import_equals.module_reference
        else {
            return false;
        };
        return matches!(
            reference.expression.value.as_str(),
            "react" | "react-dom" | "preact/compat" | "preact/hooks" | "@wordpress/element"
        );
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_kind(declaration.id()),
        AstKind::VariableDeclaration(_)
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    declarator
        .init
        .as_ref()
        .is_some_and(|initializer| match initializer {
            Expression::CallExpression(call) => multi_component_is_react_require_call(call, ctx),
            Expression::Identifier(target)
                if ctx
                    .scoping()
                    .get_reference(target.reference_id())
                    .symbol_id()
                    .is_some() =>
            {
                multi_component_is_react_namespace_expression(initializer, ctx, visited_symbols)
            }
            _ => false,
        })
}

fn multi_component_is_react_require_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    if callee.name != "require" || !ctx.is_reference_to_global_variable(callee) {
        return false;
    }
    matches!(
        call.arguments.first().and_then(Argument::as_expression),
        Some(Expression::StringLiteral(module))
            if matches!(
                module.value.as_str(),
                "react" | "react-dom" | "preact/compat" | "preact/hooks" | "@wordpress/element"
            )
    )
}

fn multi_component_is_passthrough_function(function: &oxc_ast::ast::Function<'_>) -> bool {
    function.body.as_ref().is_some_and(|body| {
        body.directives.is_empty() && multi_component_is_single_return_passthrough(&body.statements)
    })
}

fn multi_component_is_passthrough_arrow(
    function: &oxc_ast::ast::ArrowFunctionExpression<'_>,
) -> bool {
    function
        .get_expression()
        .is_some_and(multi_component_is_simple_jsx_passthrough)
        || function.get_function_body().is_some_and(|body| {
            body.directives.is_empty()
                && multi_component_is_single_return_passthrough(&body.statements)
        })
}

fn multi_component_is_single_return_passthrough(statements: &[Statement<'_>]) -> bool {
    matches!(statements, [Statement::ReturnStatement(statement)]
        if statement.argument.as_ref().is_some_and(multi_component_is_simple_jsx_passthrough))
}

fn multi_component_is_simple_jsx_passthrough(expression: &Expression<'_>) -> bool {
    let Expression::JSXElement(element) = expression.get_inner_expression() else {
        return false;
    };
    let JSXElementName::IdentifierReference(identifier) = &element.opening_element.name else {
        return false;
    };
    is_react_component_name(&identifier.name)
        && element.opening_element.attributes.len() <= 6
        && element.opening_element.attributes.iter().any(|attribute| {
            matches!(
                attribute,
                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
            )
        })
        && element.children.iter().all(|child| match child {
            JSXChild::Text(_) | JSXChild::ExpressionContainer(_) | JSXChild::Fragment(_) => true,
            JSXChild::Element(child) => matches!(
                &child.opening_element.name,
                JSXElementName::Identifier(identifier)
                    if !identifier.name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
            ),
            _ => false,
        })
}

fn multi_component_is_react_class(class: &oxc_ast::ast::Class<'_>) -> bool {
    class.heritage_expression().is_some_and(|heritage| {
        heritage.as_member_expression().is_some_and(|member| {
            matches!(member.object(), Expression::Identifier(identifier)
                if identifier.name == "React")
                && match member {
                    MemberExpression::StaticMemberExpression(member) => {
                        matches!(member.property.name.as_str(), "Component" | "PureComponent")
                    }
                    MemberExpression::ComputedMemberExpression(member) => {
                        matches!(&member.expression, Expression::Identifier(identifier)
                            if matches!(identifier.name.as_str(), "Component" | "PureComponent"))
                    }
                    MemberExpression::PrivateFieldExpression(_) => false,
                }
        }) || matches!(heritage, Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Component" | "PureComponent"))
    })
}

fn multi_component_has_export_ancestor(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut did_cross_binding_layer =
        matches!(node.kind(), AstKind::Function(_) | AstKind::Class(_));
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::ExportDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
        ) || matches!(ancestor.kind(), AstKind::AssignmentExpression(assignment)
                if multi_component_commonjs_export_target(&assignment.left, ctx).is_some())
        {
            return true;
        }
        if matches!(ancestor.kind(), AstKind::Program(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Class(_)
        ) {
            if did_cross_binding_layer {
                return false;
            }
            did_cross_binding_layer = true;
        }
    }
    false
}

fn multi_component_exported_names(ctx: &LintContext<'_>) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    let program = ctx.nodes().program();
    for statement in &program.body {
        match statement {
            Statement::ExportNamedDeclaration(declaration) => {
                for specifier in &declaration.specifiers {
                    if let ModuleExportName::IdentifierReference(identifier) = &specifier.local {
                        names.insert(identifier.name.to_string());
                        if let Some(symbol_id) = ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            && let Some(name) =
                                multi_component_exported_symbol_identity_name(symbol_id, ctx)
                        {
                            names.insert(name);
                        }
                    }
                }
            }
            Statement::ExportDefaultDeclaration(declaration) => {
                if let Some(expression) = declaration.declaration.as_expression() {
                    let expression = multi_component_unwrap_ts_cast(expression);
                    if let Expression::Identifier(identifier) = expression {
                        names.insert(identifier.name.to_string());
                    }
                    if let Some(name) = multi_component_exported_identity_name(expression, ctx) {
                        names.insert(name);
                    }
                }
            }
            Statement::ExportDeclaration(declaration) => match &declaration.declaration {
                Declaration::VariableDeclaration(declaration) => {
                    for declarator in &declaration.declarations {
                        let Some(initializer) = declarator.init.as_ref() else {
                            continue;
                        };
                        let initializer = multi_component_unwrap_ts_cast(initializer);
                        if matches!(initializer, Expression::CallExpression(_)) {
                            if let Some(name) =
                                multi_component_exported_identity_name(initializer, ctx)
                            {
                                names.insert(name);
                            }
                            continue;
                        }
                        let Expression::ObjectExpression(object) = initializer else {
                            continue;
                        };
                        for property in &object.properties {
                            if let ObjectPropertyKind::ObjectProperty(property) = property
                                && !property.computed
                                && let Expression::Identifier(identifier) =
                                    multi_component_unwrap_ts_cast(&property.value)
                            {
                                names.insert(identifier.name.to_string());
                            }
                        }
                    }
                }
                _ => {}
            },
            Statement::ExpressionStatement(statement) => {
                if let Expression::AssignmentExpression(assignment) =
                    statement.expression.get_inner_expression()
                    && let Some((_, export_name)) =
                        multi_component_commonjs_export_target(&assignment.left, ctx)
                {
                    if let Some(export_name) = export_name {
                        names.insert(export_name.to_string());
                    }
                    let exported_value = multi_component_unwrap_ts_cast(&assignment.right);
                    if let Expression::Identifier(identifier) = exported_value {
                        names.insert(identifier.name.to_string());
                    }
                    if let Some(name) = multi_component_exported_identity_name(exported_value, ctx)
                    {
                        names.insert(name);
                    }
                    if let Expression::ObjectExpression(object) = exported_value {
                        for property in &object.properties {
                            if let ObjectPropertyKind::ObjectProperty(property) = property {
                                let property_value =
                                    multi_component_unwrap_ts_cast(&property.value);
                                if let Expression::Identifier(identifier) = property_value {
                                    names.insert(identifier.name.to_string());
                                }
                                if let Some(name) =
                                    multi_component_exported_identity_name(property_value, ctx)
                                {
                                    names.insert(name);
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    names
}

fn multi_component_commonjs_export_target<'a>(
    target: &'a AssignmentTarget<'a>,
    ctx: &LintContext<'_>,
) -> Option<(Span, Option<&'a str>)> {
    let member = target.as_member_expression()?;
    let (property_span, property_name) = member.static_property_info()?;
    if matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "exports" && ctx.is_reference_to_global_variable(identifier))
    {
        return Some((property_span, Some(property_name)));
    }
    if matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "module" && property_name == "exports"
            && ctx.is_reference_to_global_variable(identifier))
    {
        return Some((property_span, None));
    }
    let receiver = member.object().as_member_expression()?;
    let Expression::Identifier(identifier) = receiver.object().get_inner_expression() else {
        return None;
    };
    (identifier.name == "module"
        && ctx.is_reference_to_global_variable(identifier)
        && receiver.static_property_name() == Some("exports"))
    .then_some((property_span, Some(property_name)))
}

fn multi_component_exported_identity_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    multi_component_exported_identity_name_after(expression, ctx, false)
}

fn multi_component_exported_identity_name_after<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    mut did_traverse_identity: bool,
) -> Option<String> {
    let mut current = multi_component_unwrap_ts_cast(expression);
    let mut visited_symbols = FxHashSet::default();
    loop {
        if let Expression::Identifier(identifier) = current {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let can_follow = !visited_symbols.contains(&symbol_id)
                && ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .all(|reference| !reference.is_write());
            let initializer = can_follow
                .then(|| ctx.symbol_declaration(symbol_id))
                .and_then(|declaration| {
                    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                        return None;
                    };
                    matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                        .then_some(declarator.init.as_ref())
                        .flatten()
                })
                .map(multi_component_unwrap_ts_cast);
            if let Some(initializer) = initializer
                && (matches!(initializer, Expression::Identifier(_))
                    || matches!(initializer, Expression::CallExpression(call)
                        if multi_component_is_react_hoc_call(&call, ctx)))
            {
                visited_symbols.insert(symbol_id);
                did_traverse_identity = true;
                current = initializer;
                continue;
            }
            return did_traverse_identity.then(|| identifier.name.to_string());
        }
        let Expression::CallExpression(call) = current else {
            return None;
        };
        if !multi_component_is_react_hoc_call(&call, ctx) {
            return None;
        }
        current = multi_component_unwrap_ts_cast(
            call.arguments.first().and_then(Argument::as_expression)?,
        );
        did_traverse_identity = true;
    }
}

fn multi_component_exported_symbol_identity_name(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return None;
    }
    let initializer = multi_component_unwrap_ts_cast(declarator.init.as_ref()?);
    if !matches!(initializer, Expression::Identifier(_))
        && !matches!(initializer, Expression::CallExpression(call)
            if multi_component_is_react_hoc_call(&call, ctx))
    {
        return None;
    }
    multi_component_exported_identity_name_after(initializer, ctx, true)
}

fn multi_component_unwrap_ts_cast<'a, 'b>(
    mut expression: &'a Expression<'b>,
) -> &'a Expression<'b> {
    loop {
        expression = match expression {
            Expression::ParenthesizedExpression(wrapper) => &wrapper.expression,
            Expression::TSAsExpression(wrapper) => &wrapper.expression,
            Expression::TSSatisfiesExpression(wrapper) => &wrapper.expression,
            Expression::TSNonNullExpression(wrapper) => &wrapper.expression,
            _ => return expression,
        };
    }
}
