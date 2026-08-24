use oxc_ast::{
    ast::{
        Expression, ImportDeclarationSpecifier, JSXElementName, JSXMemberExpression,
        JSXMemberExpressionObject, MemberExpression, ObjectExpression, ObjectPropertyKind,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const TANSTACK_ROUTER_PACKAGE: &str = "@tanstack/react-router";
const ROOT_ROUTE_FACTORY_NAMES: [&str; 2] = ["createRootRoute", "createRootRouteWithContext"];
const ROOT_COMPONENT_PROPERTY_NAMES: [&str; 2] = ["component", "shellComponent"];
const MESSAGE: &str = "Without <Scripts /> inside <body>, the __root route does not load TanStack Start's client-side JavaScript.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartMissingScripts;

declare_oxc_lint!(
    /// Require Scripts inside the document body of TanStack Start root routes.
    TanstackStartMissingScripts,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Scripts in TanStack Start root routes.",
);

impl Rule for TanstackStartMissingScripts {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_tanstack_root_route_filename(&ctx.file_path().to_string_lossy())
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut scripts_symbols = FxHashSet::default();
        let mut namespace_symbols = FxHashSet::default();
        let mut root_factory_symbols = FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
                continue;
            };
            let is_router_import = import_declaration.source.value == TANSTACK_ROUTER_PACKAGE;
            for specifier in import_declaration.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier)
                        if specifier.local.name == "Scripts" =>
                    {
                        scripts_symbols.insert(specifier.local.symbol_id());
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier)
                        if is_router_import =>
                    {
                        namespace_symbols.insert(specifier.local.symbol_id());
                    }
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        if specifier.imported.name() == "Scripts" {
                            scripts_symbols.insert(specifier.local.symbol_id());
                        }
                        if is_router_import
                            && ROOT_ROUTE_FACTORY_NAMES
                                .contains(&specifier.imported.name().as_str())
                        {
                            root_factory_symbols.insert(specifier.local.symbol_id());
                        }
                    }
                    _ => {}
                }
            }
        }

        let top_level_declarators: Vec<_> = ctx
            .nodes()
            .iter()
            .filter(|node| missing_scripts_is_top_level_variable_declarator(node, ctx))
            .collect();
        loop {
            let mut did_collect_alias = false;
            for declarator_node in &top_level_declarators {
                let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                    continue;
                };
                did_collect_alias |= missing_scripts_collect_alias(
                    declarator,
                    ctx,
                    &mut scripts_symbols,
                    &mut namespace_symbols,
                    &mut root_factory_symbols,
                );
            }
            if !did_collect_alias {
                break;
            }
        }

        let mut configured_components = FxHashSet::default();
        let mut document_bodies = Vec::new();
        let mut scripts_inside_bodies = FxHashSet::default();
        let mut scripts_value_declarations = FxHashSet::default();
        let mut scripts_wrapper_components = FxHashSet::default();
        let mut component_dependencies: FxHashMap<Span, FxHashSet<Span>> = FxHashMap::default();
        let mut body_child_components: FxHashMap<Span, FxHashSet<Span>> = FxHashMap::default();
        let mut body_expression_declarations: FxHashMap<Span, FxHashSet<Span>> =
            FxHashMap::default();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::VariableDeclarator(declarator) => {
                    missing_scripts_collect_alias(
                        declarator,
                        ctx,
                        &mut scripts_symbols,
                        &mut namespace_symbols,
                        &mut root_factory_symbols,
                    );
                }
                AstKind::CallExpression(call_expression) => {
                    if !missing_scripts_is_root_route_factory_call(
                        call_expression,
                        ctx,
                        &root_factory_symbols,
                        &namespace_symbols,
                    ) {
                        continue;
                    }
                    let Some(options_expression) = call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                    else {
                        continue;
                    };
                    let Some(options_object) = missing_scripts_resolve_options_object(
                        options_expression,
                        call_expression.span.start,
                        ctx,
                        &mut FxHashSet::default(),
                    ) else {
                        continue;
                    };
                    for property in &options_object.properties {
                        let ObjectPropertyKind::ObjectProperty(property) = property else {
                            continue;
                        };
                        let Some(property_name) = property.key.static_name() else {
                            continue;
                        };
                        if !ROOT_COMPONENT_PROPERTY_NAMES.contains(&property_name.as_ref()) {
                            continue;
                        }
                        missing_scripts_collect_configured_component(
                            &property.value,
                            ctx,
                            &mut configured_components,
                        );
                    }
                }
                AstKind::JSXOpeningElement(opening_element) => {
                    let enclosing_body = missing_scripts_enclosing_body(node.id(), ctx);
                    if missing_scripts_is_body_name(&opening_element.name) {
                        if let Some(body) = enclosing_body {
                            document_bodies.push(body);
                        }
                        continue;
                    }
                    if missing_scripts_is_scripts_name(
                        &opening_element.name,
                        ctx,
                        &scripts_symbols,
                        &namespace_symbols,
                    ) {
                        if let Some(declaration) =
                            missing_scripts_enclosing_variable_declaration(node.id(), ctx)
                        {
                            scripts_value_declarations.insert(declaration);
                        }
                        if let Some((_, body_span)) = enclosing_body {
                            scripts_inside_bodies.insert(body_span);
                        } else if let Some(component) =
                            missing_scripts_enclosing_component(node.id(), ctx)
                        {
                            scripts_wrapper_components.insert(component);
                        }
                        continue;
                    }
                    let Some(child_component) =
                        missing_scripts_jsx_component_declaration(&opening_element.name, ctx)
                    else {
                        continue;
                    };
                    if let Some((_, body_span)) = enclosing_body {
                        body_child_components
                            .entry(body_span)
                            .or_default()
                            .insert(child_component);
                    }
                    if let Some(owner_component) =
                        missing_scripts_enclosing_component(node.id(), ctx)
                    {
                        component_dependencies
                            .entry(owner_component)
                            .or_default()
                            .insert(child_component);
                    }
                }
                AstKind::JSXExpressionContainer(container) => {
                    let Some((_, body_span)) = missing_scripts_enclosing_body(node.id(), ctx)
                    else {
                        continue;
                    };
                    let Some(Expression::Identifier(identifier)) =
                        container.expression.as_expression()
                    else {
                        continue;
                    };
                    let Some(declaration) =
                        missing_scripts_reference_declaration_span(identifier, ctx)
                    else {
                        continue;
                    };
                    body_expression_declarations
                        .entry(body_span)
                        .or_default()
                        .insert(declaration);
                }
                _ => {}
            }
        }

        let reachable_root_components =
            missing_scripts_reachable_components(configured_components, &component_dependencies);
        for (body_node_id, body_span) in document_bodies {
            let Some(body_owner) = missing_scripts_enclosing_component(body_node_id, ctx) else {
                continue;
            };
            if !reachable_root_components.contains(&body_owner)
                || scripts_inside_bodies.contains(&body_span)
                || body_expression_declarations
                    .get(&body_span)
                    .is_some_and(|declarations| {
                        declarations
                            .iter()
                            .any(|declaration| scripts_value_declarations.contains(declaration))
                    })
            {
                continue;
            }
            let reachable_body_components = missing_scripts_reachable_components(
                body_child_components.remove(&body_span).unwrap_or_default(),
                &component_dependencies,
            );
            if reachable_body_components
                .iter()
                .any(|component| scripts_wrapper_components.contains(component))
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(MESSAGE).with_label(program_estree_span(ctx.nodes().program())),
            );
            return;
        }
    }
}

fn missing_scripts_is_top_level_variable_declarator(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(node.kind(), AstKind::VariableDeclarator(_)) {
        return false;
    }
    let declaration = ctx.nodes().parent_node(node.id());
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::Program(_)
    )
}

fn missing_scripts_collect_alias<'a>(
    declarator: &oxc_ast::ast::VariableDeclarator<'a>,
    ctx: &LintContext<'a>,
    scripts_symbols: &mut FxHashSet<SymbolId>,
    namespace_symbols: &mut FxHashSet<SymbolId>,
    root_factory_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(alias) = declarator.id.get_binding_identifier() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    let alias_symbol = alias.symbol_id();
    if let Expression::Identifier(identifier) = initializer.get_inner_expression() {
        let Some(initializer_symbol) = missing_scripts_reference_symbol(identifier, ctx) else {
            return false;
        };
        let mut did_collect = false;
        if scripts_symbols.contains(&initializer_symbol) {
            did_collect |= scripts_symbols.insert(alias_symbol);
        }
        if namespace_symbols.contains(&initializer_symbol) {
            did_collect |= namespace_symbols.insert(alias_symbol);
        }
        if root_factory_symbols.contains(&initializer_symbol) {
            did_collect |= root_factory_symbols.insert(alias_symbol);
        }
        return did_collect;
    }
    let Some(member_expression) = initializer.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(root_symbol) = missing_scripts_member_root_symbol(member_expression, ctx) else {
        return false;
    };
    if !namespace_symbols.contains(&root_symbol) {
        return false;
    }
    match member_expression_identifier_property_name(member_expression) {
        Some("Scripts") => scripts_symbols.insert(alias_symbol),
        Some(property_name) if ROOT_ROUTE_FACTORY_NAMES.contains(&property_name) => {
            root_factory_symbols.insert(alias_symbol)
        }
        _ => false,
    }
}

fn missing_scripts_is_root_route_factory_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    root_factory_symbols: &FxHashSet<SymbolId>,
    namespace_symbols: &FxHashSet<SymbolId>,
) -> bool {
    let mut callee = call_expression.callee.get_inner_expression();
    while let Expression::CallExpression(inner_call) = callee {
        callee = inner_call.callee.get_inner_expression();
    }
    if let Expression::Identifier(identifier) = callee {
        return missing_scripts_reference_symbol(identifier, ctx).map_or_else(
            || ROOT_ROUTE_FACTORY_NAMES.contains(&identifier.name.as_str()),
            |symbol_id| root_factory_symbols.contains(&symbol_id),
        );
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    missing_scripts_member_root_symbol(member_expression, ctx)
        .is_some_and(|symbol_id| namespace_symbols.contains(&symbol_id))
        && member_expression_identifier_property_name(member_expression)
            .is_some_and(|property_name| ROOT_ROUTE_FACTORY_NAMES.contains(&property_name))
}

fn missing_scripts_resolve_options_object<'a>(
    expression: &'a Expression<'a>,
    reference_start: u32,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<&'a ObjectExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        Expression::Identifier(identifier) => {
            let symbol_id = missing_scripts_reference_symbol(identifier, ctx)?;
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| {
                        reference.is_write()
                            && ctx.nodes().get_node(reference.node_id()).span().start
                                < reference_start
                    })
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            missing_scripts_resolve_options_object(
                declarator.init.as_ref()?,
                reference_start,
                ctx,
                visited_symbols,
            )
        }
        _ => None,
    }
}

fn missing_scripts_collect_configured_component<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    configured_components: &mut FxHashSet<Span>,
) {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            configured_components.insert(expression.get_inner_expression().span());
        }
        Expression::ClassExpression(_) => {
            configured_components.insert(expression.get_inner_expression().span());
        }
        Expression::Identifier(identifier) => {
            if let Some(declaration) = missing_scripts_reference_declaration_span(identifier, ctx) {
                configured_components.insert(declaration);
            }
        }
        _ => {}
    }
}

fn missing_scripts_is_scripts_name(
    name: &JSXElementName<'_>,
    ctx: &LintContext<'_>,
    scripts_symbols: &FxHashSet<SymbolId>,
    namespace_symbols: &FxHashSet<SymbolId>,
) -> bool {
    match name {
        JSXElementName::Identifier(identifier) => identifier.name == "Scripts",
        JSXElementName::IdentifierReference(identifier) => {
            missing_scripts_reference_symbol(identifier, ctx).map_or_else(
                || identifier.name == "Scripts",
                |symbol_id| scripts_symbols.contains(&symbol_id),
            )
        }
        JSXElementName::MemberExpression(member_expression) => {
            missing_scripts_jsx_member_root_symbol(member_expression, ctx)
                .is_some_and(|symbol_id| namespace_symbols.contains(&symbol_id))
                && member_expression.property.name == "Scripts"
        }
        _ => false,
    }
}

fn missing_scripts_is_body_name(name: &JSXElementName<'_>) -> bool {
    matches!(name, JSXElementName::Identifier(identifier) if identifier.name == "body")
}

fn missing_scripts_enclosing_body(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<(NodeId, Span)> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return None;
        };
        missing_scripts_is_body_name(&element.opening_element.name)
            .then_some((ancestor.id(), ancestor.span()))
    })
}

fn missing_scripts_enclosing_variable_declaration(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator)
                if declarator.id.get_binding_identifier().is_some() =>
            {
                return Some(ancestor.span());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return None,
            _ => {}
        }
    }
    None
}

fn missing_scripts_enclosing_component(node_id: NodeId, ctx: &LintContext<'_>) -> Option<Span> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::Function(function) if function.is_function_declaration() => {
                return Some(ancestor.span());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                let function_root = transparent_expression_root(ancestor, ctx);
                let parent = ctx.nodes().parent_node(function_root.id());
                if matches!(parent.kind(), AstKind::MethodDefinition(method) if method.key.static_name().as_deref() == Some("render"))
                    || matches!(parent.kind(), AstKind::PropertyDefinition(property) if property.key.static_name().as_deref() == Some("render"))
                {
                    let class_node = ctx
                        .nodes()
                        .ancestors(parent.id())
                        .find(|candidate| matches!(candidate.kind(), AstKind::Class(_)))?;
                    return Some(missing_scripts_class_declaration(class_node, ctx));
                }
                if matches!(parent.kind(), AstKind::VariableDeclarator(declarator) if declarator.id.get_binding_identifier().is_some())
                {
                    return Some(parent.span());
                }
                return Some(ancestor.span());
            }
            _ => {}
        }
    }
    None
}

fn missing_scripts_class_declaration(class_node: &AstNode<'_>, ctx: &LintContext<'_>) -> Span {
    let parent = ctx.nodes().parent_node(class_node.id());
    if matches!(parent.kind(), AstKind::VariableDeclarator(declarator) if declarator.id.get_binding_identifier().is_some())
    {
        return parent.span();
    }
    let AstKind::Class(class) = class_node.kind() else {
        return class_node.span();
    };
    class
        .id
        .as_ref()
        .map(|identifier| ctx.symbol_declaration(identifier.symbol_id()).span())
        .unwrap_or_else(|| class_node.span())
}

fn missing_scripts_jsx_component_declaration(
    name: &JSXElementName<'_>,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    let JSXElementName::IdentifierReference(identifier) = name else {
        return None;
    };
    missing_scripts_reference_declaration_span(identifier, ctx)
}

fn missing_scripts_reachable_components(
    initial_components: FxHashSet<Span>,
    dependencies: &FxHashMap<Span, FxHashSet<Span>>,
) -> FxHashSet<Span> {
    let mut reachable = initial_components;
    let mut pending: Vec<_> = reachable.iter().copied().collect();
    let mut index = 0;
    while let Some(component) = pending.get(index).copied() {
        index += 1;
        for dependency in dependencies.get(&component).into_iter().flatten() {
            if reachable.insert(*dependency) {
                pending.push(*dependency);
            }
        }
    }
    reachable
}

fn missing_scripts_reference_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn missing_scripts_reference_declaration_span(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    missing_scripts_reference_symbol(identifier, ctx)
        .map(|symbol_id| ctx.symbol_declaration(symbol_id).span())
}

fn missing_scripts_member_root_symbol(
    member_expression: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match member_expression.object().get_inner_expression() {
        Expression::Identifier(identifier) => missing_scripts_reference_symbol(identifier, ctx),
        expression => missing_scripts_member_root_symbol(expression.as_member_expression()?, ctx),
    }
}

fn missing_scripts_jsx_member_root_symbol(
    member_expression: &JSXMemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match &member_expression.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => {
            missing_scripts_reference_symbol(identifier, ctx)
        }
        JSXMemberExpressionObject::MemberExpression(member_expression) => {
            missing_scripts_jsx_member_root_symbol(member_expression, ctx)
        }
        JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}
