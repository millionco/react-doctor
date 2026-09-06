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

const REACT_NATIVE_TEXT_COMPONENTS: &[&str] = &[
    "Text",
    "TextInput",
    "Typography",
    "Paragraph",
    "Span",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
];
const REACT_NATIVE_TEXT_KEYWORDS: &[&str] = &[
    "Text",
    "Title",
    "Label",
    "Heading",
    "Caption",
    "Subtitle",
    "Typography",
    "Paragraph",
    "Description",
    "Body",
];
const REACT_NATIVE_RAW_TEXT_HOSTS: &[&str] = &[
    "View",
    "ScrollView",
    "SafeAreaView",
    "KeyboardAvoidingView",
    "ImageBackground",
    "Modal",
    "Pressable",
    "TouchableOpacity",
    "TouchableHighlight",
    "TouchableWithoutFeedback",
    "TouchableNativeFeedback",
];
const REACT_NATIVE_MAX_CHILDREN_ALIAS_PASSES: usize = 3;

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

fn collect_react_native_children_forwarding_components<'a>(
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> FxHashMap<SymbolId, ChildrenForwardingKind> {
    let binding_counts = react_native_component_binding_counts(semantic, module_record);
    let components = collect_react_native_forwarding_components(semantic)
        .into_iter()
        .filter(|component| {
            binding_counts.get(semantic.scoping().symbol_name(component.symbol_id)) == Some(&1)
        })
        .collect::<Vec<_>>();
    let styled_components = collect_react_native_styled_components(semantic)
        .into_iter()
        .filter(|component| {
            binding_counts.get(semantic.scoping().symbol_name(component.symbol_id)) == Some(&1)
        })
        .collect::<Vec<_>>();
    let mut forwarding_kinds = components
        .iter()
        .map(|component| (component.symbol_id, ChildrenForwardingKind::Unknown))
        .chain(
            styled_components
                .iter()
                .map(|component| (component.symbol_id, ChildrenForwardingKind::Unknown)),
        )
        .collect::<FxHashMap<_, _>>();

    loop {
        let mut did_change = false;
        for component in &styled_components {
            let styled_node = semantic.nodes().get_node(component.declarator_node_id);
            let AstKind::VariableDeclarator(declarator) = styled_node.kind() else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let next_kind =
                react_native_styled_component_kind(initializer, semantic, &forwarding_kinds);
            if forwarding_kinds.get(&component.symbol_id) != Some(&next_kind) {
                forwarding_kinds.insert(component.symbol_id, next_kind);
                did_change = true;
            }
        }
        for component in &components {
            let next_kind = classify_react_native_forwarding_component(
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

#[derive(Debug, Clone, Copy)]
struct ReactNativeStyledComponent {
    symbol_id: SymbolId,
    declarator_node_id: NodeId,
}

fn react_native_component_binding_counts(
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> FxHashMap<String, usize> {
    let mut counts = FxHashMap::default();
    for entry in &module_record.import_entries {
        let name = entry.local_name.name();
        if is_react_component_name(name) {
            *counts.entry(name.to_string()).or_default() += 1;
        }
    }
    for node in semantic.nodes().iter() {
        let name = match node.kind() {
            AstKind::Function(function) if function.is_function_declaration() => function
                .id
                .as_ref()
                .map(|identifier| identifier.name.as_str()),
            AstKind::VariableDeclarator(declarator) => declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.name.as_str()),
            AstKind::Class(class)
                if matches!(
                    semantic.nodes().parent_node(node.id()).kind(),
                    AstKind::Program(_)
                        | AstKind::ExportDefaultDeclaration(_)
                        | AstKind::ExportNamedDeclaration(_)
                ) =>
            {
                class.id.as_ref().map(|identifier| identifier.name.as_str())
            }
            _ => None,
        };
        if let Some(name) = name.filter(|name| is_react_component_name(name)) {
            *counts.entry(name.to_string()).or_default() += 1;
        }
    }
    counts
}

fn collect_react_native_styled_components(
    semantic: &Semantic<'_>,
) -> Vec<ReactNativeStyledComponent> {
    semantic
        .nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                return None;
            };
            let identifier = declarator.id.get_binding_identifier()?;
            if !is_react_component_name(identifier.name.as_str()) {
                return None;
            }
            let initializer = declarator.init.as_ref()?;
            react_native_styled_base(initializer, semantic)?;
            Some(ReactNativeStyledComponent {
                symbol_id: identifier.symbol_id(),
                declarator_node_id: node.id(),
            })
        })
        .collect()
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

fn collect_react_native_forwarding_components(semantic: &Semantic<'_>) -> Vec<ForwardingComponent> {
    let mut components = collect_forwarding_components(semantic);
    for node in semantic.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            continue;
        };
        let Some(identifier) = declarator.id.get_binding_identifier() else {
            continue;
        };
        if !is_react_component_name(identifier.name.as_str()) {
            continue;
        }
        let Some(Expression::ClassExpression(class)) = &declarator.init else {
            continue;
        };
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

fn react_native_element_is_inside_text_receiver(
    node: &AstNode<'_>,
    returned_root_spans: &[Span],
    semantic: &Semantic<'_>,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> bool {
    for ancestor in semantic.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(element)
                if returned_root_spans
                    .iter()
                    .any(|root_span| root_span.contains_inclusive(element.span)) =>
            {
                if react_native_jsx_receiver_kind(
                    &element.opening_element,
                    semantic,
                    forwarding_kinds,
                ) == ChildrenForwardingKind::Text
                {
                    return true;
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn classify_react_native_forwarding_component(
    component: ForwardingComponent,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> ChildrenForwardingKind {
    classify_react_native_function_node(
        component.function_node_id,
        semantic,
        module_record,
        forwarding_kinds,
    )
}

fn classify_react_native_function_node(
    function_node_id: NodeId,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> ChildrenForwardingKind {
    let function_node = semantic.nodes().get_node(function_node_id);
    let mut bindings = react_native_children_bindings_for_function(function_node);
    collect_react_native_children_aliases(function_node_id, semantic, &mut bindings);
    let returned_root_spans = returned_jsx_root_spans(function_node_id, semantic);
    if returned_root_spans.is_empty() {
        return ChildrenForwardingKind::Unknown;
    }

    let mut did_forward_into_text = false;
    let mut did_forward_into_unknown = false;
    for node in semantic.nodes().iter() {
        let AstKind::JSXElement(element) = node.kind() else {
            continue;
        };
        if nearest_function_node_id(node, semantic) != Some(function_node_id)
            || !returned_root_spans
                .iter()
                .any(|root_span| root_span.contains_inclusive(element.span))
            || react_native_element_is_inside_text_receiver(
                node,
                &returned_root_spans,
                semantic,
                forwarding_kinds,
            )
        {
            continue;
        }
        let receiver_kind =
            react_native_jsx_receiver_kind(&element.opening_element, semantic, forwarding_kinds);
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

fn react_native_children_bindings_for_function(function_node: &AstNode<'_>) -> ChildrenBindings {
    let mut bindings = children_bindings_for_function(function_node);
    bindings.accepts_this_props = true;
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

fn collect_react_native_children_aliases(
    function_node_id: NodeId,
    semantic: &Semantic<'_>,
    bindings: &mut ChildrenBindings,
) {
    for _ in 0..REACT_NATIVE_MAX_CHILDREN_ALIAS_PASSES {
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

fn react_native_jsx_receiver_kind<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    semantic: &Semantic<'a>,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> ChildrenForwardingKind {
    let Some(name) = react_native_jsx_element_name(&opening_element.name) else {
        return ChildrenForwardingKind::Unknown;
    };
    if react_native_is_text_name(name) {
        return ChildrenForwardingKind::Text;
    }
    if react_native_is_non_text_host_name(name) {
        return ChildrenForwardingKind::NonText;
    }
    jsx_element_symbol_id(&opening_element.name, semantic)
        .and_then(|symbol_id| forwarding_kinds.get(&symbol_id).copied())
        .unwrap_or(ChildrenForwardingKind::Unknown)
}

fn react_native_jsx_element_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        JSXElementName::MemberExpression(member) => Some(member.property.name.as_str()),
        JSXElementName::NamespacedName(name) => Some(name.namespace.name.as_str()),
        _ => None,
    }
}

fn react_native_is_text_name(name: &str) -> bool {
    REACT_NATIVE_TEXT_COMPONENTS.contains(&name)
        || REACT_NATIVE_TEXT_KEYWORDS
            .iter()
            .any(|keyword| name.contains(keyword))
}

fn react_native_is_non_text_host_name(name: &str) -> bool {
    REACT_NATIVE_RAW_TEXT_HOSTS.contains(&name)
        || (!is_react_component_name(name)
            && !crate::globals::HTML_TAG.contains(name)
            && !is_svg_tag_name(name))
}

struct ReactNativeStyledBase {
    name: String,
    symbol_id: Option<SymbolId>,
}

fn react_native_styled_base(
    definition: &Expression<'_>,
    semantic: &Semantic<'_>,
) -> Option<ReactNativeStyledBase> {
    let mut current = definition.get_inner_expression();
    loop {
        match current {
            Expression::TaggedTemplateExpression(template) => {
                current = template.tag.get_inner_expression();
            }
            Expression::CallExpression(call) => {
                let callee = call.callee.get_inner_expression();
                if matches!(callee, Expression::Identifier(identifier) if identifier.name == "styled")
                {
                    let argument = call
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)?
                        .get_inner_expression();
                    let Expression::Identifier(identifier) = argument else {
                        return None;
                    };
                    return Some(ReactNativeStyledBase {
                        name: identifier.name.to_string(),
                        symbol_id: reference_symbol_id(identifier, semantic),
                    });
                }
                current = callee;
            }
            expression => {
                let member = expression.as_member_expression()?;
                if matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "styled")
                {
                    return member_expression_identifier_property_name(member).map(|name| {
                        ReactNativeStyledBase {
                            name: name.to_string(),
                            symbol_id: None,
                        }
                    });
                }
                current = member.object().get_inner_expression();
            }
        }
    }
}

fn react_native_styled_component_kind(
    definition: &Expression<'_>,
    semantic: &Semantic<'_>,
    forwarding_kinds: &FxHashMap<SymbolId, ChildrenForwardingKind>,
) -> ChildrenForwardingKind {
    let Some(base) = react_native_styled_base(definition, semantic) else {
        return ChildrenForwardingKind::Unknown;
    };
    if react_native_is_text_name(&base.name) {
        return ChildrenForwardingKind::Text;
    }
    if react_native_is_non_text_host_name(&base.name) {
        return ChildrenForwardingKind::NonText;
    }
    base.symbol_id
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

fn resolve_imported_react_native_component_forwarding<'a>(
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
    classify_exported_component_for_renderer(&imported_file_path, exported_name, 0, true)
}

fn classify_exported_component(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
) -> ChildrenForwardingKind {
    classify_exported_component_for_renderer(file_path, exported_name, depth, false)
}

fn classify_exported_component_for_renderer(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
    is_react_native: bool,
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
    let forwarding_kinds = if is_react_native {
        collect_react_native_children_forwarding_components(&semantic, &module_record)
    } else {
        collect_children_forwarding_components(&semantic, &module_record)
    };
    if let Some(symbol_id) = exported_component_symbol_id(exported_name, &semantic, &module_record)
    {
        return forwarding_kinds
            .get(&symbol_id)
            .copied()
            .unwrap_or(ChildrenForwardingKind::Unknown);
    }
    if is_react_native
        && exported_name == "default"
        && let Some(function_node_id) = anonymous_default_component_function_node_id(&semantic)
    {
        return classify_react_native_function_node(
            function_node_id,
            &semantic,
            &module_record,
            &forwarding_kinds,
        );
    }
    let Some((source, imported_name)) = reexport_target(exported_name, &module_record) else {
        return ChildrenForwardingKind::Unknown;
    };
    let Some(reexported_file_path) = resolve_first_party_module_path(file_path, source) else {
        return ChildrenForwardingKind::Unknown;
    };
    classify_exported_component_for_renderer(
        &reexported_file_path,
        imported_name,
        depth + 1,
        is_react_native,
    )
}

fn anonymous_default_component_function_node_id(semantic: &Semantic<'_>) -> Option<NodeId> {
    for node in semantic.nodes().iter() {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            continue;
        };
        let Some(expression) = declaration.declaration.as_expression() else {
            continue;
        };
        if let Some(function_node_id) = component_function_node_id(expression) {
            return Some(function_node_id);
        }
        let Expression::ClassExpression(class) = expression.get_inner_expression() else {
            continue;
        };
        if let Some(function_node_id) = class.body.body.iter().find_map(|element| {
            let oxc_ast::ast::ClassElement::MethodDefinition(method) = element else {
                return None;
            };
            (method.key.static_name().as_deref() == Some("render"))
                .then(|| method.value.node_id.get())
        }) {
            return Some(function_node_id);
        }
    }
    for node in semantic.nodes().iter() {
        let Some(function_node_id) = (match node.kind() {
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_) => Some(node.id()),
            AstKind::Class(class) => class.body.body.iter().find_map(|element| {
                let oxc_ast::ast::ClassElement::MethodDefinition(method) = element else {
                    return None;
                };
                (method.key.static_name().as_deref() == Some("render"))
                    .then(|| method.value.node_id.get())
            }),
            _ => None,
        }) else {
            continue;
        };
        let mut current = node;
        loop {
            let parent = semantic.nodes().parent_node(current.id());
            if matches!(parent.kind(), AstKind::ExportDefaultDeclaration(_)) {
                return Some(function_node_id);
            }
            if !matches!(
                parent.kind(),
                AstKind::ParenthesizedExpression(_)
                    | AstKind::TSAsExpression(_)
                    | AstKind::TSSatisfiesExpression(_)
                    | AstKind::TSTypeAssertion(_)
                    | AstKind::TSNonNullExpression(_)
                    | AstKind::TSInstantiationExpression(_)
                    | AstKind::ChainExpression(_)
            ) {
                break;
            }
            current = parent;
        }
    }
    None
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
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
