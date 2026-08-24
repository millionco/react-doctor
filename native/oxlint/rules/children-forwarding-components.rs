use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXChild, JSXElement, JSXElementName, JSXMemberExpressionObject,
    },
};
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span, VALID_EXTENSIONS};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    module_record::{
        ExportExportName, ExportImportName, ImportEntry, ImportImportName, ModuleRecord,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildrenForwardingKind {
    Text,
    NonText,
    Unknown,
}

#[derive(Debug, Default)]
struct ChildrenBindings {
    children_symbol_ids: FxHashSet<SymbolId>,
    props_symbol_ids: FxHashSet<SymbolId>,
    accepts_this_props: bool,
}

#[derive(Debug, Clone, Copy)]
struct ForwardingComponent {
    symbol_id: SymbolId,
    function_node_id: NodeId,
}

fn collect_children_forwarding_components<'a>(
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> FxHashMap<SymbolId, ChildrenForwardingKind> {
    let components = collect_forwarding_components(semantic);
    let mut forwarding_kinds = components
        .iter()
        .map(|component| (component.symbol_id, ChildrenForwardingKind::Unknown))
        .collect::<FxHashMap<_, _>>();

    loop {
        let mut did_change = false;
        for component in &components {
            let next_kind = classify_forwarding_component(
                *component,
                semantic,
                module_record,
                &forwarding_kinds,
            );
            if forwarding_kinds.get(&component.symbol_id) != Some(&next_kind) {
                forwarding_kinds.insert(component.symbol_id, next_kind);
                did_change = true;
            }
        }
        if !did_change {
            break;
        }
    }

    forwarding_kinds
}

fn collect_forwarding_components(semantic: &Semantic<'_>) -> Vec<ForwardingComponent> {
    let mut components = Vec::new();
    for node in semantic.nodes().iter() {
        match node.kind() {
            AstKind::Function(function) if function.is_function_declaration() => {
                let Some(identifier) = &function.id else {
                    continue;
                };
                if is_react_component_name(identifier.name.as_str()) {
                    components.push(ForwardingComponent {
                        symbol_id: identifier.symbol_id(),
                        function_node_id: node.id(),
                    });
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                let Some(identifier) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                if !is_react_component_name(identifier.name.as_str()) {
                    continue;
                }
                let Some(initializer) = &declarator.init else {
                    continue;
                };
                let Some(function_node_id) = component_function_node_id(initializer) else {
                    continue;
                };
                components.push(ForwardingComponent {
                    symbol_id: identifier.symbol_id(),
                    function_node_id,
                });
            }
            AstKind::Class(class) => {
                let Some(identifier) = &class.id else {
                    continue;
                };
                if !is_react_component_name(identifier.name.as_str()) {
                    continue;
                }
                let Some(function_node_id) = class.body.body.iter().find_map(|element| {
                    let oxc_ast::ast::ClassElement::MethodDefinition(method) = element else {
                        return None;
                    };
                    (method.key.static_name().as_deref() == Some("render"))
                        .then(|| method.value.node_id.get())
                }) else {
                    continue;
                };
                components.push(ForwardingComponent {
                    symbol_id: identifier.symbol_id(),
                    function_node_id,
                });
            }
            _ => {}
        }
    }
    components
}

fn component_function_node_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::CallExpression(call)
            if matches!(call.callee_name(), Some("memo" | "forwardRef")) =>
        {
            call.arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .and_then(component_function_node_id)
        }
        _ => None,
    }
}

fn classify_forwarding_component(
    component: ForwardingComponent,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> ChildrenForwardingKind {
    let function_node = semantic.nodes().get_node(component.function_node_id);
    let mut bindings = children_bindings_for_function(function_node);
    collect_children_aliases(component.function_node_id, semantic, &mut bindings);
    let returned_root_spans = returned_jsx_root_spans(component.function_node_id, semantic);
    if returned_root_spans.is_empty() {
        return ChildrenForwardingKind::Unknown;
    }

    let mut did_forward_into_text = false;
    let mut did_forward_into_unknown = false;
    for node in semantic.nodes().iter() {
        let AstKind::JSXElement(element) = node.kind() else {
            continue;
        };
        if nearest_function_node_id(node, semantic) != Some(component.function_node_id)
            || !returned_root_spans
                .iter()
                .any(|root_span| root_span.contains_inclusive(element.span))
        {
            continue;
        }
        let receiver_kind = jsx_receiver_kind(
            &element.opening_element,
            semantic,
            module_record,
            forwarding_kinds,
        );
        let forwards_children =
            jsx_element_forwards_children(element, &bindings, semantic, module_record);
        if forwards_children {
            match receiver_kind {
                ChildrenForwardingKind::NonText => return ChildrenForwardingKind::NonText,
                ChildrenForwardingKind::Text => did_forward_into_text = true,
                ChildrenForwardingKind::Unknown => did_forward_into_unknown = true,
            }
        }
        if returned_root_spans.contains(&element.span)
            && receiver_kind == ChildrenForwardingKind::Text
        {
            did_forward_into_text = true;
        }
    }

    if did_forward_into_unknown {
        ChildrenForwardingKind::Unknown
    } else if did_forward_into_text {
        ChildrenForwardingKind::Text
    } else {
        ChildrenForwardingKind::Unknown
    }
}

fn children_bindings_for_function(function_node: &AstNode<'_>) -> ChildrenBindings {
    let (parameters, accepts_this_props) = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) => (Some(function.params.as_ref()), false),
        AstKind::Function(function) => (Some(function.params.as_ref()), true),
        _ => (None, false),
    };
    let mut bindings = ChildrenBindings {
        accepts_this_props,
        ..ChildrenBindings::default()
    };
    let Some(first_parameter) = parameters.and_then(|parameters| parameters.items.first()) else {
        return bindings;
    };
    collect_parameter_children_bindings(&first_parameter.pattern, &mut bindings);
    bindings
}

fn collect_parameter_children_bindings(
    pattern: &BindingPattern<'_>,
    bindings: &mut ChildrenBindings,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            bindings.props_symbol_ids.insert(identifier.symbol_id());
        }
        BindingPattern::ObjectPattern(pattern) => {
            let mut did_destructure_children = false;
            for property in &pattern.properties {
                if property.key.static_name().as_deref() != Some("children") {
                    continue;
                }
                did_destructure_children = true;
                collect_binding_symbol_ids(&property.value, &mut bindings.children_symbol_ids);
            }
            if !did_destructure_children && let Some(rest) = &pattern.rest {
                collect_binding_symbol_ids(&rest.argument, &mut bindings.props_symbol_ids);
            }
        }
        _ => {}
    }
}

fn collect_binding_symbol_ids(pattern: &BindingPattern<'_>, symbol_ids: &mut FxHashSet<SymbolId>) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            symbol_ids.insert(identifier.symbol_id());
        }
        BindingPattern::AssignmentPattern(pattern) => {
            collect_binding_symbol_ids(&pattern.left, symbol_ids);
        }
        _ => {}
    }
}

fn collect_children_aliases(
    function_node_id: NodeId,
    semantic: &Semantic<'_>,
    bindings: &mut ChildrenBindings,
) {
    loop {
        let children_count = bindings.children_symbol_ids.len();
        for node in semantic.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            if nearest_function_node_id(node, semantic) != Some(function_node_id) {
                continue;
            }
            let Some(initializer) = &declarator.init else {
                continue;
            };
            if let Some(identifier) = declarator.id.get_binding_identifier() {
                if is_children_value_expression(initializer, bindings, semantic) {
                    bindings.children_symbol_ids.insert(identifier.symbol_id());
                }
                continue;
            }
            let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
                continue;
            };
            if !is_props_object_expression(initializer, bindings, semantic) {
                continue;
            }
            for property in &pattern.properties {
                if property.key.static_name().as_deref() == Some("children") {
                    collect_binding_symbol_ids(&property.value, &mut bindings.children_symbol_ids);
                }
            }
        }
        if bindings.children_symbol_ids.len() == children_count {
            break;
        }
    }
}

fn returned_jsx_root_spans(function_node_id: NodeId, semantic: &Semantic<'_>) -> Vec<Span> {
    let function_node = semantic.nodes().get_node(function_node_id);
    let mut spans = Vec::new();
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        collect_jsx_expression_root_spans(expression, &mut spans);
    }
    for node in semantic.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = node.kind() else {
            continue;
        };
        if nearest_function_node_id(node, semantic) != Some(function_node_id) {
            continue;
        }
        if let Some(argument) = &return_statement.argument {
            collect_jsx_expression_root_spans(argument, &mut spans);
        }
    }
    spans
}

fn collect_jsx_expression_root_spans(expression: &Expression<'_>, spans: &mut Vec<Span>) {
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => spans.push(element.span),
        Expression::JSXFragment(fragment) => spans.push(fragment.span),
        Expression::ConditionalExpression(conditional) => {
            collect_jsx_expression_root_spans(&conditional.consequent, spans);
            collect_jsx_expression_root_spans(&conditional.alternate, spans);
        }
        Expression::LogicalExpression(logical) => {
            collect_jsx_expression_root_spans(&logical.left, spans);
            collect_jsx_expression_root_spans(&logical.right, spans);
        }
        _ => {}
    }
}

fn nearest_function_node_id(node: &AstNode<'_>, semantic: &Semantic<'_>) -> Option<NodeId> {
    semantic.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn jsx_element_forwards_children<'a>(
    element: &JSXElement<'a>,
    bindings: &ChildrenBindings,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> bool {
    if element
        .children
        .iter()
        .any(|child| jsx_child_forwards_children(child, bindings, semantic, module_record))
    {
        return true;
    }
    if element.children.iter().any(is_non_whitespace_jsx_child) {
        return false;
    }
    element
        .opening_element
        .attributes
        .iter()
        .any(|attribute| jsx_attribute_forwards_children(attribute, bindings, semantic))
}

fn jsx_child_forwards_children<'a>(
    child: &JSXChild<'a>,
    bindings: &ChildrenBindings,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> bool {
    match child {
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| is_children_value_expression(expression, bindings, semantic)),
        JSXChild::Fragment(fragment) => fragment
            .children
            .iter()
            .any(|child| jsx_child_forwards_children(child, bindings, semantic, module_record)),
        JSXChild::Element(element)
            if is_react_fragment_element(
                &element.opening_element.name,
                semantic,
                module_record,
            ) =>
        {
            element
                .children
                .iter()
                .any(|child| jsx_child_forwards_children(child, bindings, semantic, module_record))
        }
        _ => false,
    }
}

fn is_non_whitespace_jsx_child(child: &JSXChild<'_>) -> bool {
    !matches!(child, JSXChild::Text(text) if text.value.trim().is_empty())
}

fn jsx_attribute_forwards_children<'a>(
    attribute: &JSXAttributeItem<'a>,
    bindings: &ChildrenBindings,
    semantic: &Semantic<'a>,
) -> bool {
    match attribute {
        JSXAttributeItem::SpreadAttribute(spread) => {
            is_props_object_expression(&spread.argument, bindings, semantic)
        }
        JSXAttributeItem::Attribute(attribute)
            if matches!(
                &attribute.name,
                JSXAttributeName::Identifier(identifier) if identifier.name == "children"
            ) =>
        {
            matches!(
                &attribute.value,
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if container.expression.as_expression().is_some_and(|expression| {
                        is_children_value_expression(expression, bindings, semantic)
                    })
            )
        }
        _ => false,
    }
}

fn is_children_value_expression<'a>(
    expression: &Expression<'a>,
    bindings: &ChildrenBindings,
    semantic: &Semantic<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return reference_symbol_id(identifier, semantic)
            .is_some_and(|symbol_id| bindings.children_symbol_ids.contains(&symbol_id));
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some("children")
        && is_props_object_expression(member_expression.object(), bindings, semantic)
}

fn is_props_object_expression<'a>(
    expression: &Expression<'a>,
    bindings: &ChildrenBindings,
    semantic: &Semantic<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return reference_symbol_id(identifier, semantic)
            .is_some_and(|symbol_id| bindings.props_symbol_ids.contains(&symbol_id));
    }
    if !bindings.accepts_this_props {
        return false;
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some("props")
        && matches!(
            member_expression.object().get_inner_expression(),
            Expression::ThisExpression(_)
        )
}

fn reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &Semantic<'_>,
) -> Option<SymbolId> {
    semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn jsx_receiver_kind<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> ChildrenForwardingKind {
    if let Some(ink_name) =
        resolve_module_jsx_component_name(opening_element, "ink", semantic, module_record)
    {
        return if matches!(ink_name, "Text" | "Transform") {
            ChildrenForwardingKind::Text
        } else {
            ChildrenForwardingKind::NonText
        };
    }
    jsx_element_symbol_id(&opening_element.name, semantic)
        .and_then(|symbol_id| forwarding_kinds.get(&symbol_id).copied())
        .unwrap_or(ChildrenForwardingKind::Unknown)
}

fn jsx_element_symbol_id<'a>(
    element_name: &JSXElementName<'a>,
    semantic: &Semantic<'a>,
) -> Option<SymbolId> {
    let JSXElementName::IdentifierReference(identifier) = element_name else {
        return None;
    };
    reference_symbol_id(identifier, semantic)
}

fn resolve_module_jsx_component_name<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    module_source: &str,
    semantic: &Semantic<'a>,
    module_record: &'b ModuleRecord,
) -> Option<&'b str> {
    match &opening_element.name {
        JSXElementName::IdentifierReference(identifier) => {
            let import_entry =
                resolve_identifier_module_import(identifier, semantic, module_record)?;
            if import_entry.module_request.name() != module_source {
                return None;
            }
            match &import_entry.import_name {
                ImportImportName::Name(imported_name) => Some(imported_name.name()),
                ImportImportName::Default(_) => Some("default"),
                ImportImportName::NamespaceObject => None,
            }
        }
        JSXElementName::MemberExpression(member_expression) => {
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return None;
            };
            let import_entry =
                resolve_identifier_module_import(identifier, semantic, module_record)?;
            (import_entry.module_request.name() == module_source
                && matches!(import_entry.import_name, ImportImportName::NamespaceObject))
            .then_some(member_expression.property.name.as_str())
        }
        _ => None,
    }
}

fn resolve_identifier_module_import<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    semantic: &Semantic<'a>,
    module_record: &'b ModuleRecord,
) -> Option<&'b ImportEntry> {
    let symbol_id = reference_symbol_id(identifier, semantic)?;
    module_record.import_entries.iter().find(|entry| {
        !entry.is_type
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn is_react_fragment_element<'a>(
    element_name: &JSXElementName<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> bool {
    match element_name {
        JSXElementName::IdentifierReference(identifier) => {
            if let Some(import_entry) =
                resolve_identifier_module_import(identifier, semantic, module_record)
            {
                return import_entry.module_request.name() == "react"
                    && matches!(
                        &import_entry.import_name,
                        ImportImportName::Name(imported_name)
                            if imported_name.name() == "Fragment"
                    );
            }
            identifier.name == "Fragment" && reference_symbol_id(identifier, semantic).is_none()
        }
        JSXElementName::MemberExpression(member_expression) => {
            if member_expression.property.name != "Fragment" {
                return false;
            }
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            if let Some(import_entry) =
                resolve_identifier_module_import(identifier, semantic, module_record)
            {
                return import_entry.module_request.name() == "react"
                    && match &import_entry.import_name {
                        ImportImportName::Default(_) | ImportImportName::NamespaceObject => true,
                        ImportImportName::Name(imported_name) => imported_name.name() == "default",
                    };
            }
            identifier.name == "React" && reference_symbol_id(identifier, semantic).is_none()
        }
        _ => false,
    }
}

fn resolve_imported_component_forwarding<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    from_file_path: &Path,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> ChildrenForwardingKind {
    let JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
        return ChildrenForwardingKind::Unknown;
    };
    let Some(import_entry) = resolve_identifier_module_import(identifier, semantic, module_record)
    else {
        return ChildrenForwardingKind::Unknown;
    };
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(imported_name) => imported_name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return ChildrenForwardingKind::Unknown,
    };
    let Some(imported_file_path) =
        resolve_first_party_module_path(from_file_path, import_entry.module_request.name())
    else {
        return ChildrenForwardingKind::Unknown;
    };
    classify_exported_component(&imported_file_path, exported_name, 0)
}

fn classify_exported_component(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
) -> ChildrenForwardingKind {
    if depth >= 4 {
        return ChildrenForwardingKind::Unknown;
    }
    let Ok(source_text) = std::fs::read_to_string(file_path) else {
        return ChildrenForwardingKind::Unknown;
    };
    let Ok(source_type) = SourceType::from_path(file_path) else {
        return ChildrenForwardingKind::Unknown;
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if !parser_return.diagnostics.is_empty() {
        return ChildrenForwardingKind::Unknown;
    }
    let semantic_return =
        SemanticBuilder::new_linter().build(allocator.alloc(parser_return.program));
    if !semantic_return.diagnostics.is_empty() {
        return ChildrenForwardingKind::Unknown;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    let forwarding_kinds = collect_children_forwarding_components(&semantic, &module_record);
    if let Some(symbol_id) = exported_component_symbol_id(exported_name, &semantic, &module_record)
    {
        return forwarding_kinds
            .get(&symbol_id)
            .copied()
            .unwrap_or(ChildrenForwardingKind::Unknown);
    }
    let Some((source, imported_name)) = reexport_target(exported_name, &module_record) else {
        return ChildrenForwardingKind::Unknown;
    };
    let Some(reexported_file_path) = resolve_first_party_module_path(file_path, source) else {
        return ChildrenForwardingKind::Unknown;
    };
    classify_exported_component(&reexported_file_path, imported_name, depth + 1)
}

fn exported_component_symbol_id(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<SymbolId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let does_export_match = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) => exported_name == "default",
                ExportExportName::Null => false,
            };
            does_export_match.then(|| entry.local_name.name()).flatten()
        })?;
    semantic.scoping().get_root_binding(local_name.into())
}

fn reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let export_name = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
            };
            if export_name != exported_name {
                return None;
            }
            let source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((source, imported_name))
        })
}

fn resolve_first_party_module_path(from_file_path: &Path, module_source: &str) -> Option<PathBuf> {
    let resolver = Resolver::new(ResolveOptions {
        extensions: VALID_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
        main_fields: vec!["module".into(), "main".into()],
        condition_names: vec!["module".into(), "import".into()],
        extension_alias: vec![
            (".js".into(), vec![".js".into(), ".ts".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let resolution = resolver.resolve_file(from_file_path, module_source).ok()?;
    let resolved_path = resolution.path().to_path_buf();
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn is_react_component_name(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}
