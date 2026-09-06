use rustc_hash::{FxHashMap, FxHashSet};

use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpression, ArrayExpressionElement, Expression, JSXAttributeItem, JSXAttributeName,
        JSXAttributeValue, JSXChild, JSXElement, JSXExpression, JSXFragment,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan as _, Span};

use crate::{
    AstNode,
    ast_util::is_node_within_call_argument,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TARGET_METHODS: [&str; 3] = ["flatMap", "from", "map"];

fn missing_key_prop_for_element_in_array(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::error("Your users can see the wrong data when this array reorders.")
        .with_label(span)
}

fn missing_key_prop_for_element_in_iterator(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::error("Your users can see the wrong data when this list reorders.")
        .with_label(span)
}

fn key_prop_must_be_placed_before_spread(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::error(
        "Place this `key` after the `{...spread}` so the spread cannot override it.",
    )
    .with_label(span)
}

fn duplicate_key_prop(key_value: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::error(format!(
        "Your users can see the wrong data because two elements share the key \"{key_value}\"."
    ))
    .with_label(span)
}

#[derive(Debug, Default, Clone)]
pub struct JsxKey;

struct JsxKeySettings {
    check_key_must_before_spread: bool,
    warn_on_duplicates: bool,
}

declare_oxc_lint!(
    /// ### What it does
    ///
    /// Enforce `key` prop for elements in an array.
    ///
    /// ### Why is this bad?
    ///
    /// React [requires a `key` prop](https://react.dev/learn/rendering-lists#rendering-data-from-arrays)
    /// for elements in an array to help identify which items have changed, are added, or are removed.
    ///
    /// ### Examples
    ///
    /// Examples of **incorrect** code for this rule:
    /// ```jsx
    /// [1, 2, 3].map(x => <App />);
    /// [1, 2, 3]?.map(x => <ListItem />)
    /// ```
    ///
    /// Examples of **correct** code for this rule:
    /// ```jsx
    /// [1, 2, 3].map(x => <App key={x} />);
    /// [1, 2, 3]?.map(x => <ListItem key={x} />)
    /// ```
    ///
    /// NOTE: This rule's option defaults differ from the defaults in the original ESLint plugin. It is recommended to keep
    /// all options set to `true` for correctness reasons, but you may want to set them back to `false` to get behavior
    /// parity when migrating from ESLint.
    JsxKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Enforce `key` prop for elements in an array.",
);

impl Rule for JsxKey {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = jsx_key_settings(ctx);
        let curated_behavior = should_use_curated_port_behavior(ctx);
        let mut named_callback_cache = FxHashMap::default();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXElement(jsx_elem) => {
                    check_jsx_element(
                        node,
                        jsx_elem,
                        curated_behavior,
                        &mut named_callback_cache,
                        ctx,
                    );
                    if settings.check_key_must_before_spread {
                        check_jsx_element_is_key_before_spread(jsx_elem, curated_behavior, ctx);
                    }
                    if settings.warn_on_duplicates {
                        check_duplicate_keys_in_children(jsx_elem, ctx);
                    }
                }
                AstKind::JSXFragment(jsx_frag) if !curated_behavior => {
                    check_jsx_fragment(node, jsx_frag, ctx);
                }
                AstKind::ArrayExpression(array_expr) if settings.warn_on_duplicates => {
                    check_duplicate_keys_in_array(array_expr, ctx);
                }

                _ => {}
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn jsx_key_settings(ctx: &LintContext<'_>) -> JsxKeySettings {
    let settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxKey"));
    JsxKeySettings {
        check_key_must_before_spread: settings
            .and_then(|settings| settings.get("checkKeyMustBeforeSpread"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
        warn_on_duplicates: settings
            .and_then(|settings| settings.get("warnOnDuplicates"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

fn is_within_children_to_array<'a, 'b>(node: &'b AstNode<'a>, ctx: &'b LintContext<'a>) -> bool {
    let parents_iter = ctx.nodes().ancestors(node.id()).skip(1);
    parents_iter
        .filter_map(|parent_node| parent_node.kind().as_call_expression())
        .any(|call| {
            let Some(member) = call.callee.as_member_expression() else {
                return false;
            };
            if member.static_property_name() != Some("toArray") {
                return false;
            }
            let object = member.object().get_inner_expression();
            matches!(object, Expression::Identifier(identifier) if identifier.name == "Children")
                || object
                    .as_member_expression()
                    .is_some_and(|inner| inner.static_property_name() == Some("Children"))
        })
}

enum InsideArrayOrIterator {
    Array,
    Iterator(NodeId),
}

#[expect(clippy::bool_to_int_with_if)]
fn is_in_array_or_iter<'a, 'b>(
    node: &'b AstNode<'a>,
    curated_behavior: bool,
    named_callback_cache: &mut FxHashMap<NodeId, Option<NodeId>>,
    ctx: &'b LintContext<'a>,
) -> Option<InsideArrayOrIterator> {
    let jsx_node = node;
    let mut node = node;

    let mut is_outside_containing_function = false;
    let mut is_explicit_return = false;

    while !matches!(node.kind(), AstKind::Program(_)) {
        let parent = ctx.nodes().parent_node(node.id());
        match parent.kind() {
            AstKind::ArrowFunctionExpression(arrow_expr) => {
                let is_arrow_expr_statement = arrow_expr.is_expression();
                if !is_explicit_return && !is_arrow_expr_statement {
                    return None;
                }

                if let AstKind::ObjectProperty(_) = ctx.nodes().parent_kind(parent.id()) {
                    return None;
                }
                if is_outside_containing_function {
                    return None;
                }

                if curated_behavior
                    && let Some(call_id) =
                        find_named_callback_iterator_call(parent, named_callback_cache, ctx)
                {
                    return Some(InsideArrayOrIterator::Iterator(call_id));
                }

                is_outside_containing_function = true;
            }
            AstKind::Function(_) => {
                if let AstKind::ObjectProperty(_) = ctx.nodes().parent_kind(parent.id()) {
                    return None;
                }
                if is_outside_containing_function {
                    return None;
                }

                if curated_behavior
                    && let Some(call_id) =
                        find_named_callback_iterator_call(parent, named_callback_cache, ctx)
                {
                    return Some(InsideArrayOrIterator::Iterator(call_id));
                }

                is_outside_containing_function = true;
            }
            AstKind::ArrayExpression(_) => {
                if is_outside_containing_function {
                    return None;
                }

                if curated_behavior && curated_array_is_not_rendered(parent, ctx) {
                    return None;
                }

                return Some(InsideArrayOrIterator::Array);
            }
            AstKind::CallExpression(v) => {
                let callee = &v.callee.without_parentheses();

                if let Some(member_expr) = callee.as_member_expression()
                    && let Some((_span, ident)) = member_expr.static_property_info()
                    && TARGET_METHODS.contains(&ident)
                {
                    // Early exit if no arguments to check
                    if v.arguments.is_empty() {
                        return None;
                    }

                    // Array.from uses 2nd argument (index 1), others use 1st argument (index 0)
                    let target_arg_index = if ident == "from" { 1 } else { 0 };
                    if is_node_within_call_argument(jsx_node, v, target_arg_index) {
                        if curated_behavior && is_non_children_jsx_attribute_value(parent, ctx) {
                            return None;
                        }
                        return Some(InsideArrayOrIterator::Iterator(parent.id()));
                    }
                }

                return None;
            }
            AstKind::JSXElement(_)
            | AstKind::JSXOpeningElement(_)
            | AstKind::ObjectProperty(_)
            | AstKind::JSXFragment(_) => return None,
            AstKind::ReturnStatement(_) => {
                is_explicit_return = true;
            }
            _ => {}
        }
        node = parent;
    }

    None
}

fn find_named_callback_iterator_call<'a, 'b>(
    function_node: &'b AstNode<'a>,
    cache: &mut FxHashMap<NodeId, Option<NodeId>>,
    ctx: &'b LintContext<'a>,
) -> Option<NodeId> {
    if let Some(cached) = cache.get(&function_node.id()) {
        return *cached;
    }
    let binding_symbol_id = match function_node.kind() {
        AstKind::Function(function) if function.id.is_some() => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let function_root = transparent_expression_root(function_node, ctx);
            let parent = ctx.nodes().parent_node(function_root.id());
            match parent.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id()),
                AstKind::AssignmentExpression(assignment) => {
                    let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                        &assignment.left
                    else {
                        return None;
                    };
                    ctx.scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                }
                _ => None,
            }
        }
        _ => None,
    }?;
    for reference in ctx.scoping().get_resolved_references(binding_symbol_id) {
        let reference_node =
            transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
        let call_node = ctx.nodes().parent_node(reference_node.id());
        let AstKind::CallExpression(call) = call_node.kind() else {
            continue;
        };
        let Some(member) = call.callee.as_member_expression() else {
            continue;
        };
        let Some(method_name) = member.static_property_name() else {
            continue;
        };
        if !TARGET_METHODS.contains(&method_name) {
            continue;
        }
        let callback_index = usize::from(method_name == "from");
        if call
            .arguments
            .get(callback_index)
            .is_some_and(|argument| argument.span() == reference_node.span())
            && !is_non_children_jsx_attribute_value(call_node, ctx)
        {
            let result = Some(call_node.id());
            cache.insert(function_node.id(), result);
            return result;
        }
    }
    cache.insert(function_node.id(), None);
    None
}

fn is_non_children_jsx_attribute_value<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let expression_root = jsx_key_consumption_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::JSXExpressionContainer(_) = parent.kind() else {
        return false;
    };
    let attribute_node = ctx.nodes().parent_node(parent.id());
    let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
        return false;
    };
    !matches!(
        &attribute.name,
        JSXAttributeName::Identifier(identifier) if identifier.name == "children"
    )
}

fn jsx_key_consumption_root<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    let mut root = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        let is_value_wrapper = match parent.kind() {
            AstKind::LogicalExpression(logical) => {
                logical.left.span() == root.span() || logical.right.span() == root.span()
            }
            AstKind::ConditionalExpression(conditional) => {
                conditional.consequent.span() == root.span()
                    || conditional.alternate.span() == root.span()
            }
            _ => false,
        };
        if !is_value_wrapper {
            return root;
        }
        root = transparent_expression_root(parent, ctx);
    }
}

fn curated_array_is_not_rendered<'a, 'b>(
    array_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    if is_non_children_jsx_attribute_value(array_node, ctx) {
        return true;
    }
    let root = jsx_key_consumption_root(array_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    if matches!(
        parent.kind(),
        AstKind::ObjectProperty(_) | AstKind::ArrayExpression(_)
    ) {
        return true;
    }
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == root.span())
        && let Some(binding) = declarator.id.get_binding_identifier()
    {
        return !array_binding_is_rendered(binding.symbol_id(), ctx);
    }
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    let Some(argument_index) = call
        .arguments
        .iter()
        .position(|argument| argument.span() == root.span())
    else {
        return false;
    };
    let is_unbound_create_element = matches!(
        call.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "createElement"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    );
    if is_react_api_call(call, "createElement", ctx) || is_unbound_create_element {
        return argument_index < 2;
    }
    let callee_name = call.callee_name();
    !matches!(
        callee_name,
        Some("createPortal" | "hydrate" | "hydrateRoot" | "render")
    )
}

fn array_binding_is_rendered(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            is_list_rendering_reference(ctx.nodes().get_node(reference.node_id()), ctx)
        })
}

fn is_list_rendering_reference<'a, 'b>(
    reference: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(reference, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::JSXExpressionContainer(_) => {
            let container_parent = ctx.nodes().parent_node(parent.id());
            matches!(
                container_parent.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            ) || matches!(
                container_parent.kind(),
                AstKind::JSXAttribute(attribute)
                    if matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == "children")
            )
        }
        AstKind::ReturnStatement(_) => true,
        AstKind::ArrowFunctionExpression(function) => function
            .get_expression()
            .is_some_and(|expression| expression.span() == root.span()),
        AstKind::StaticMemberExpression(member) if member.object.span() == root.span() => {
            let method_name = member.property.name.as_str();
            if !TARGET_METHODS.contains(&method_name) {
                return false;
            }
            let call_node = ctx.nodes().parent_node(parent.id());
            let AstKind::CallExpression(call) = call_node.kind() else {
                return false;
            };
            call.arguments
                .first()
                .and_then(|argument| argument.as_expression())
                .is_none_or(|callback| identity_iterator_callback(callback, ctx))
        }
        _ => false,
    }
}

fn identity_iterator_callback(callback: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let callback = callback.get_inner_expression();
    let (parameter_name, body_span) = match callback {
        Expression::ArrowFunctionExpression(function) => {
            let Some(parameter) = function
                .params
                .items
                .first()
                .and_then(|parameter| parameter.pattern.get_binding_identifier())
            else {
                return false;
            };
            if function.get_expression().is_some_and(|expression| {
                matches!(
                    expression.get_inner_expression(),
                    Expression::Identifier(identifier) if identifier.name == parameter.name
                )
            }) {
                return true;
            }
            (parameter.name.to_string(), function.body.span())
        }
        Expression::FunctionExpression(function) => {
            let Some(parameter) = function
                .params
                .items
                .first()
                .and_then(|parameter| parameter.pattern.get_binding_identifier())
            else {
                return false;
            };
            let Some(body) = &function.body else {
                return false;
            };
            (parameter.name.to_string(), body.span)
        }
        Expression::Identifier(_) => return true,
        _ => return false,
    };
    ctx.nodes().iter().any(|candidate| {
        if !body_span.contains_inclusive(candidate.span()) {
            return false;
        }
        matches!(
            candidate.kind(),
            AstKind::ReturnStatement(statement)
                if matches!(
                    statement.argument.as_ref().map(Expression::get_inner_expression),
                    Some(Expression::Identifier(identifier))
                        if identifier.name.as_str() == parameter_name.as_str()
                )
        )
    })
}

fn check_jsx_element<'a>(
    node: &AstNode<'a>,
    jsx_elem: &JSXElement<'a>,
    curated_behavior: bool,
    named_callback_cache: &mut FxHashMap<NodeId, Option<NodeId>>,
    ctx: &LintContext<'a>,
) {
    if let Some(outer) = is_in_array_or_iter(node, curated_behavior, named_callback_cache, ctx) {
        if is_within_children_to_array(node, ctx) {
            return;
        }
        if !jsx_elem.opening_element.attributes.iter().any(|attr| {
            let JSXAttributeItem::Attribute(attr) = attr else {
                return false;
            };

            let JSXAttributeName::Identifier(attr_ident) = &attr.name else {
                return false;
            };
            attr_ident.name == "key"
        }) && (!curated_behavior
            || (!has_key_carrying_spread(&jsx_elem.opening_element, ctx, 0)
                && !has_call_expression_spread(&jsx_elem.opening_element)
                && !spreads_iteration_item(&jsx_elem.opening_element, &outer, ctx)))
        {
            ctx.diagnostic(gen_diagnostic(jsx_elem.opening_element.span, &outer));
        }
    }
}

fn check_jsx_element_is_key_before_spread<'a>(
    jsx_elem: &JSXElement<'a>,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    if curated_behavior {
        check_curated_key_before_spread(jsx_elem, ctx);
        return;
    }
    let mut key_idx_span: Option<(usize, Span)> = None;
    let mut spread_idx: Option<usize> = None;

    for (i, attr) in jsx_elem.opening_element.attributes.iter().enumerate() {
        match attr {
            JSXAttributeItem::Attribute(attr) => {
                let JSXAttributeName::Identifier(ident) = &attr.name else {
                    continue;
                };
                if ident.name == "key" {
                    key_idx_span = Some((i, attr.span));
                }
            }
            JSXAttributeItem::SpreadAttribute(_) => spread_idx = Some(i),
        }
        if key_idx_span.map(|x| x.0).is_some() && spread_idx.is_some() {
            break;
        }
    }

    if let (Some((key_idx, key_span)), Some(spread_idx)) = (key_idx_span, spread_idx)
        && key_idx > spread_idx
    {
        ctx.diagnostic(key_prop_must_be_placed_before_spread(key_span));
    }
}

fn check_curated_key_before_spread<'a>(jsx_elem: &JSXElement<'a>, ctx: &LintContext<'a>) {
    let mut key_index_span = None;
    let mut last_key_spread_index = None;
    for (attribute_index, attribute) in jsx_elem.opening_element.attributes.iter().enumerate() {
        match attribute {
            JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == "key") =>
            {
                key_index_span = Some((attribute_index, attribute.span));
            }
            JSXAttributeItem::SpreadAttribute(attribute)
                if spread_expression_has_key(&attribute.argument, ctx, 0) =>
            {
                last_key_spread_index = Some(attribute_index);
            }
            _ => {}
        }
    }
    if let (Some((key_index, key_span)), Some(spread_index)) =
        (key_index_span, last_key_spread_index)
        && spread_index > key_index
    {
        ctx.diagnostic(key_prop_must_be_placed_before_spread(key_span));
    }
}

fn spread_expression_has_key<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    const MAX_DEPTH: usize = 3;
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ObjectExpression(object) => {
            object.properties.iter().any(|property| match property {
                oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                    property.key.static_name().as_deref() == Some("key")
                }
                oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) if depth < MAX_DEPTH => {
                    spread_expression_has_key(&spread.argument, ctx, depth + 1)
                }
                _ => false,
            })
        }
        Expression::ConditionalExpression(conditional) if depth < MAX_DEPTH => {
            spread_expression_has_key(&conditional.consequent, ctx, depth + 1)
                || spread_expression_has_key(&conditional.alternate, ctx, depth + 1)
        }
        Expression::LogicalExpression(logical) if depth < MAX_DEPTH => {
            if logical.operator == oxc_syntax::operator::LogicalOperator::And {
                spread_expression_has_key(&logical.right, ctx, depth + 1)
            } else {
                spread_expression_has_key(&logical.left, ctx, depth + 1)
                    || spread_expression_has_key(&logical.right, ctx, depth + 1)
            }
        }
        Expression::Identifier(identifier)
            if identifier.name != "undefined" && depth < MAX_DEPTH =>
        {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            let Some(symbol_id) = reference.symbol_id() else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if declarator.id.get_binding_identifier().is_none() {
                return false;
            }
            let parent = ctx.nodes().parent_node(declaration.id());
            let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return false;
            };
            variable_declaration.kind.is_const()
                && (symbol_is_assigned_key(symbol_id, ctx)
                    || declarator.init.as_ref().is_some_and(|initializer| {
                        spread_expression_has_key(initializer, ctx, depth + 1)
                    }))
        }
        _ => false,
    }
}

fn symbol_is_assigned_key(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping().get_resolved_references(symbol_id).any(|reference| {
        let reference_node = transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
        let parent = ctx.nodes().parent_node(reference_node.id());
        let member_property_is_key = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.property.name == "key",
            AstKind::ComputedMemberExpression(member) => {
                matches!(member.expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "key")
            }
            _ => false,
        };
        if let Some(member) = parent.kind().as_member_expression_kind()
            && member.object().span() == reference_node.span()
            && member_property_is_key
        {
            let assignment = ctx.nodes().parent_node(parent.id());
            if matches!(assignment.kind(), AstKind::AssignmentExpression(expression) if expression.left.span() == parent.span()) {
                return true;
            }
        }
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        if member.static_property_name() != Some("assign")
            || !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Object")
            || call.arguments.first().is_none_or(|argument| argument.span() != reference_node.span())
        {
            return false;
        }
        call.arguments.iter().skip(1).any(|argument| {
            let Some(Expression::ObjectExpression(object)) = argument.as_expression().map(Expression::get_inner_expression) else {
                return false;
            };
            object.properties.iter().any(|property| {
                matches!(
                    property,
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                        if property.key.static_name().as_deref() == Some("key")
                )
            })
        })
    })
}

fn has_key_carrying_spread<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            JSXAttributeItem::SpreadAttribute(spread)
                if spread_expression_has_key(&spread.argument, ctx, depth)
        )
    })
}

fn has_call_expression_spread(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            JSXAttributeItem::SpreadAttribute(spread)
                if matches!(spread.argument.get_inner_expression(), Expression::CallExpression(_))
        )
    })
}

fn spreads_iteration_item<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    context: &InsideArrayOrIterator,
    ctx: &LintContext<'a>,
) -> bool {
    let InsideArrayOrIterator::Iterator(call_id) = context else {
        return false;
    };
    let AstKind::CallExpression(call) = ctx.nodes().get_node(*call_id).kind() else {
        return false;
    };
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let callback_index = usize::from(member.static_property_name().as_deref() == Some("from"));
    let Some(callback) = call
        .arguments
        .get(callback_index)
        .and_then(|argument| argument.as_expression())
    else {
        return false;
    };
    let Some(item_name) = iteration_callback_first_parameter_name(callback, ctx) else {
        return false;
    };
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            JSXAttributeItem::SpreadAttribute(spread)
                if matches!(
                    spread.argument.get_inner_expression(),
                    Expression::Identifier(spread_identifier)
                        if spread_identifier.name.as_str() == item_name.as_str()
                )
        )
    })
}

fn iteration_callback_first_parameter_name<'a>(
    callback: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let callback = callback.get_inner_expression();
    let function_node = match callback {
        Expression::ArrowFunctionExpression(function) => Some(&function.params),
        Expression::FunctionExpression(function) => Some(&function.params),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(&function.params),
                AstKind::VariableDeclarator(declarator) => {
                    match declarator.init.as_ref()?.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => Some(&function.params),
                        Expression::FunctionExpression(function) => Some(&function.params),
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }?;
    function_node
        .items
        .first()?
        .pattern
        .get_binding_identifier()
        .map(|identifier| identifier.name.to_string())
}

fn check_jsx_fragment<'a>(node: &AstNode<'a>, fragment: &JSXFragment<'a>, ctx: &LintContext<'a>) {
    if let Some(outer) = is_in_array_or_iter(node, false, &mut FxHashMap::default(), ctx) {
        if is_within_children_to_array(node, ctx) {
            return;
        }
        ctx.diagnostic(gen_diagnostic(fragment.span, &outer));
    }
}

fn gen_diagnostic(span: Span, outer: &InsideArrayOrIterator) -> OxcDiagnostic {
    match outer {
        InsideArrayOrIterator::Array => missing_key_prop_for_element_in_array(span),
        InsideArrayOrIterator::Iterator(_) => missing_key_prop_for_element_in_iterator(span),
    }
}

fn get_jsx_element_key_value(jsx_elem: &JSXElement) -> Option<(String, Span)> {
    for attr in &jsx_elem.opening_element.attributes {
        if let JSXAttributeItem::Attribute(attr) = attr
            && let JSXAttributeName::Identifier(ident) = &attr.name
            && ident.name == "key"
        {
            // Extract the key value
            if let Some(value) = &attr.value {
                match value {
                    JSXAttributeValue::StringLiteral(lit) => {
                        return Some((lit.value.to_string(), attr.span));
                    }
                    JSXAttributeValue::ExpressionContainer(container) => {
                        // JSXExpression inherits from Expression, so we match the Expression variants directly
                        match &container.expression {
                            JSXExpression::StringLiteral(lit) => {
                                return Some((lit.value.to_string(), attr.span));
                            }
                            JSXExpression::NumericLiteral(lit) => {
                                let key = if lit.value == 0.0 {
                                    "0".to_string()
                                } else {
                                    lit.value.to_string()
                                };
                                return Some((key, attr.span));
                            }
                            JSXExpression::TemplateLiteral(lit)
                                if lit.expressions.is_empty() && lit.quasis.len() == 1 =>
                            {
                                let value = lit.quasis[0]
                                    .value
                                    .cooked
                                    .as_ref()
                                    .unwrap_or(&lit.quasis[0].value.raw)
                                    .to_string();
                                return Some((value, attr.span));
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    None
}

fn check_duplicate_keys_in_array<'a>(array_expr: &ArrayExpression<'a>, ctx: &LintContext<'a>) {
    let mut seen_keys: FxHashSet<String> = FxHashSet::default();

    for element in &array_expr.elements {
        // ArrayExpressionElement also inherits from Expression
        if let ArrayExpressionElement::JSXElement(jsx_elem) = element
            && let Some((key_value, span)) = get_jsx_element_key_value(jsx_elem)
            && !seen_keys.insert(key_value.clone())
        {
            ctx.diagnostic(duplicate_key_prop(&key_value, span));
        }
    }
}

fn check_duplicate_keys_in_children<'a>(jsx_elem: &JSXElement<'a>, ctx: &LintContext<'a>) {
    let mut seen_keys: FxHashSet<String> = FxHashSet::default();

    for child in &jsx_elem.children {
        if let JSXChild::Element(child_elem) = child
            && let Some((key_value, span)) = get_jsx_element_key_value(child_elem)
            && !seen_keys.insert(key_value.clone())
        {
            ctx.diagnostic(duplicate_key_prop(&key_value, span));
        }
    }
}
