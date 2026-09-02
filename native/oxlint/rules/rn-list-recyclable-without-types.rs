use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXChild,
        JSXElementName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const SHOPIFY_MODULE_SOURCE: &str = "@shopify/flash-list";
const SHOPIFY_COMPONENT_NAMES: [&str; 2] = ["FlashList", "AnimatedFlashList"];
const LEGEND_RECYCLERS: [(&str, &str); 6] = [
    ("@legendapp/list/react-native", "LegendList"),
    ("@legendapp/list/animated", "AnimatedLegendList"),
    ("@legendapp/list/reanimated", "AnimatedLegendList"),
    ("@legendapp/list/keyboard", "KeyboardAwareLegendList"),
    (
        "@legendapp/list/keyboard-legacy",
        "KeyboardAvoidingLegendList",
    ),
    ("@legendapp/list", "LegendList"),
];

#[derive(Debug, Default, Clone)]
pub struct RnListRecyclableWithoutTypes;

declare_oxc_lint!(
    /// Warns when heterogeneous recyclable rows do not provide `getItemType`.
    RnListRecyclableWithoutTypes,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Recyclable list missing getItemType.",
);

#[derive(Clone, Copy)]
struct RecyclableRenderer {
    node_id: NodeId,
    parameters_span: Span,
}

#[derive(Default)]
struct RecyclableRenderedRoots {
    has_input_dependent_selection: bool,
    identities: FxHashSet<String>,
}

impl Rule for RnListRecyclableWithoutTypes {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut node_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut opening_element_node_ids = Vec::new();
        for node in ctx.nodes().iter() {
            if matches!(node.kind(), AstKind::JSXOpeningElement(_)) {
                opening_element_node_ids.push(node.id());
            }
            if let Some(function_id) = recyclable_nearest_function_id(node, ctx) {
                node_ids_by_function
                    .entry(function_id)
                    .or_default()
                    .push(node.id());
            }
        }

        let mut heterogeneous_renderer_results = FxHashMap::<NodeId, bool>::default();
        for opening_element_node_id in opening_element_node_ids {
            let opening_element_node = ctx.nodes().get_node(opening_element_node_id);
            let AstKind::JSXOpeningElement(opening_element) = opening_element_node.kind() else {
                continue;
            };
            let Some(canonical_name) = recyclable_imported_component_name(opening_element, ctx)
            else {
                continue;
            };
            if !recyclable_items_are_enabled(opening_element, canonical_name, ctx)
                || recyclable_has_possible_get_item_type(opening_element)
            {
                continue;
            }
            let Some(render_item_attribute) =
                get_authoritative_jsx_attribute(opening_element, "renderItem", true)
            else {
                continue;
            };
            let Some(renderer) = recyclable_resolve_render_item(render_item_attribute, ctx) else {
                continue;
            };
            let is_heterogeneous = *heterogeneous_renderer_results
                .entry(renderer.node_id)
                .or_insert_with(|| {
                    recyclable_renderer_has_heterogeneous_roots(
                        renderer,
                        &node_ids_by_function,
                        ctx,
                    )
                });
            if !is_heterogeneous {
                continue;
            }
            let Some(element_name) = resolve_jsx_element_name(opening_element) else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see rows of different shapes reuse the wrong cells when <{element_name}> recycles them without `getItemType`."
                ))
                .with_label(opening_element.span),
            );
        }
    }
}

fn recyclable_nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn recyclable_imported_component_name<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    if let Some(name) =
        resolve_imported_jsx_component_name(opening_element, SHOPIFY_MODULE_SOURCE, ctx)
        && SHOPIFY_COMPONENT_NAMES.contains(&name)
    {
        return Some(name);
    }
    LEGEND_RECYCLERS
        .iter()
        .find_map(|(module_source, expected_name)| {
            (resolve_imported_jsx_component_name(opening_element, module_source, ctx)
                == Some(*expected_name))
            .then_some(*expected_name)
        })
}

fn recyclable_items_are_enabled(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    canonical_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let is_shopify_v2 = SHOPIFY_COMPONENT_NAMES.contains(&canonical_name)
        && ctx
            .settings()
            .json
            .as_ref()
            .and_then(|settings| settings.get("react-doctor"))
            .and_then(serde_json::Value::as_object)
            .and_then(|settings| settings.get("shopifyFlashListMajorVersion"))
            .and_then(serde_json::Value::as_f64)
            .is_some_and(|version| version >= 2.0);
    let has_written_recycle_items = opening_element.attributes.iter().any(|attribute| {
        matches!(attribute, JSXAttributeItem::Attribute(attribute)
            if jsx_attribute_name_matches(attribute, "recycleItems", true))
    });
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "recycleItems", true)
    else {
        let has_possible_recycle_items_spread =
            opening_element.attributes.iter().any(|attribute| {
                matches!(attribute, JSXAttributeItem::SpreadAttribute(spread)
                if can_expression_override_jsx_attribute(&spread.argument, "recycleItems", true))
            });
        return is_shopify_v2 && !has_written_recycle_items && !has_possible_recycle_items_spread;
    };
    match &attribute.value {
        None => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            !matches!(container.expression.as_expression(), Some(Expression::BooleanLiteral(value)) if !value.value)
        }
        _ => true,
    }
}

fn recyclable_has_possible_get_item_type(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| match attribute {
            JSXAttributeItem::Attribute(attribute) => {
                jsx_attribute_name_matches(attribute, "getItemType", true)
            }
            JSXAttributeItem::SpreadAttribute(spread) => {
                can_expression_override_jsx_attribute(&spread.argument, "getItemType", true)
            }
        })
}

fn recyclable_resolve_render_item<'a>(
    attribute: &JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) -> Option<RecyclableRenderer> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    let expression = container.expression.as_expression()?.get_inner_expression();
    recyclable_resolve_renderer_expression(expression, ctx, &mut FxHashSet::default())
}

fn recyclable_resolve_renderer_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<RecyclableRenderer> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(RecyclableRenderer {
            node_id: function.node_id.get(),
            parameters_span: function.params.span,
        }),
        Expression::FunctionExpression(function) => Some(RecyclableRenderer {
            node_id: function.node_id.get(),
            parameters_span: function.params.span,
        }),
        Expression::CallExpression(call) if is_react_api_call(call, "useCallback", ctx) => {
            recyclable_resolve_renderer_expression(
                call.arguments.first()?.as_expression()?,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(RecyclableRenderer {
                    node_id: function.node_id.get(),
                    parameters_span: function.params.span,
                }),
                AstKind::VariableDeclarator(_) => recyclable_resolve_renderer_expression(
                    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?,
                    ctx,
                    visited_symbol_ids,
                ),
                _ => None,
            }
        }
        _ => None,
    }
}

fn recyclable_renderer_has_heterogeneous_roots(
    renderer: RecyclableRenderer,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> bool {
    let input_symbol_ids =
        recyclable_renderer_input_symbol_ids(renderer, node_ids_by_function, ctx);
    if input_symbol_ids.is_empty() {
        return false;
    }
    let input_and_alias_symbol_ids =
        recyclable_expand_input_aliases(renderer, &input_symbol_ids, node_ids_by_function, ctx);
    let mut rendered_roots = RecyclableRenderedRoots::default();
    let renderer_node = ctx.nodes().get_node(renderer.node_id);
    if let AstKind::ArrowFunctionExpression(function) = renderer_node.kind()
        && let Some(expression) = function.get_expression()
    {
        recyclable_collect_expression_roots(
            expression,
            &input_and_alias_symbol_ids,
            node_ids_by_function,
            ctx,
            &mut rendered_roots,
            &mut FxHashSet::default(),
        );
    }
    for node_id in node_ids_by_function
        .get(&renderer.node_id)
        .into_iter()
        .flatten()
    {
        let node = ctx.nodes().get_node(*node_id);
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if !is_node_reachable_within_function(node, renderer_node, ctx) {
            continue;
        }
        let Some(argument) = &statement.argument else {
            continue;
        };
        rendered_roots.has_input_dependent_selection |= recyclable_return_is_input_selected(
            node,
            renderer.node_id,
            &input_and_alias_symbol_ids,
            node_ids_by_function
                .get(&renderer.node_id)
                .map_or(&[], Vec::as_slice),
            ctx,
        );
        recyclable_collect_expression_roots(
            argument,
            &input_and_alias_symbol_ids,
            node_ids_by_function,
            ctx,
            &mut rendered_roots,
            &mut FxHashSet::default(),
        );
    }
    rendered_roots.has_input_dependent_selection && rendered_roots.identities.len() > 1
}

fn recyclable_renderer_input_symbol_ids(
    renderer: RecyclableRenderer,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    let first_parameter = match ctx.nodes().get_node(renderer.node_id).kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    };
    let Some(first_parameter) = first_parameter else {
        return symbols;
    };
    if let BindingPattern::BindingIdentifier(identifier) = &first_parameter.pattern {
        if !ctx
            .scoping()
            .get_resolved_references(identifier.symbol_id())
            .any(oxc_semantic::Reference::is_write)
        {
            symbols.insert(identifier.symbol_id());
        }
        return symbols;
    }
    let Some(node_ids) = node_ids_by_function.get(&renderer.node_id) else {
        return symbols;
    };
    for node_id in node_ids {
        let node = ctx.nodes().get_node(*node_id);
        let AstKind::BindingIdentifier(identifier) = node.kind() else {
            continue;
        };
        if !renderer.parameters_span.contains_inclusive(identifier.span) {
            continue;
        }
        if binding_property_name_for_symbol(&first_parameter.pattern, identifier.symbol_id())
            .is_some_and(|name| matches!(name.as_str(), "item" | "index"))
            && !ctx
                .scoping()
                .get_resolved_references(identifier.symbol_id())
                .any(oxc_semantic::Reference::is_write)
        {
            symbols.insert(identifier.symbol_id());
        }
    }
    symbols
}

fn recyclable_expand_input_aliases(
    renderer: RecyclableRenderer,
    initial_symbols: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut symbols = initial_symbols.clone();
    let Some(node_ids) = node_ids_by_function.get(&renderer.node_id) else {
        return symbols;
    };
    loop {
        let mut did_add_symbol = false;
        for node_id in node_ids {
            let node = ctx.nodes().get_node(*node_id);
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            if !recyclable_selector_is_input_dependent(initializer, &symbols, node_ids, ctx) {
                continue;
            }
            for binding_node_id in node_ids {
                let binding_node = ctx.nodes().get_node(*binding_node_id);
                let AstKind::BindingIdentifier(binding) = binding_node.kind() else {
                    continue;
                };
                if !declarator.id.span().contains_inclusive(binding.span)
                    || symbols.contains(&binding.symbol_id())
                    || ctx
                        .scoping()
                        .get_resolved_references(binding.symbol_id())
                        .any(oxc_semantic::Reference::is_write)
                {
                    continue;
                }
                did_add_symbol |= symbols.insert(binding.symbol_id());
            }
        }
        if !did_add_symbol {
            return symbols;
        }
    }
}

fn recyclable_expression_references_symbols(
    expression: &Expression<'_>,
    symbols: &FxHashSet<SymbolId>,
    indexed_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    indexed_node_ids.iter().any(|node_id| {
        let node = ctx.nodes().get_node(*node_id);
        if !expression.span().contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return false;
        };
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| symbols.contains(&symbol_id))
    })
}

fn recyclable_selector_is_input_dependent(
    selector: &Expression<'_>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    indexed_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    recyclable_selector_is_input_dependent_internal(
        selector,
        input_symbol_ids,
        indexed_node_ids,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn recyclable_selector_is_input_dependent_internal(
    selector: &Expression<'_>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    indexed_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if recyclable_expression_is_statically_truthy_container(selector) {
        return false;
    }
    if !recyclable_expression_references_symbols(selector, input_symbol_ids, indexed_node_ids, ctx)
    {
        return false;
    }
    indexed_node_ids.iter().all(|node_id| {
        let node = ctx.nodes().get_node(*node_id);
        if !selector.span().contains_inclusive(node.span()) {
            return true;
        }
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return true;
        };
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
        if symbol_id.is_some_and(|symbol_id| input_symbol_ids.contains(&symbol_id)) {
            return true;
        }
        if recyclable_identifier_is_static_property_name(node, ctx) {
            return true;
        }
        if recyclable_identifier_is_proven_static_callee(node, ctx) {
            return symbol_id.is_none()
                || resolve_identifier_import(identifier, ctx).is_some()
                || symbol_id
                    .is_some_and(|symbol_id| recyclable_symbol_is_stable_function(symbol_id, ctx));
        }
        if resolve_identifier_import(identifier, ctx).is_some()
            && recyclable_identifier_is_comparison_operand(node, ctx)
        {
            return true;
        }
        let Some(symbol_id) = symbol_id else {
            return false;
        };
        let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
        else {
            return false;
        };
        if recyclable_expression_is_static_primitive(initializer) {
            return recyclable_identifier_is_comparison_operand(node, ctx);
        }
        if !visited_symbol_ids.insert(symbol_id) {
            return false;
        }
        let is_input_dependent = recyclable_selector_is_input_dependent_internal(
            initializer,
            input_symbol_ids,
            indexed_node_ids,
            ctx,
            visited_symbol_ids,
        );
        visited_symbol_ids.remove(&symbol_id);
        is_input_dependent
    })
}

fn recyclable_expression_is_statically_truthy_container(expression: &Expression<'_>) -> bool {
    matches!(
        recyclable_final_expression(expression).get_inner_expression(),
        Expression::ArrayExpression(_)
            | Expression::ObjectExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ClassExpression(_)
            | Expression::NewExpression(_)
            | Expression::JSXElement(_)
            | Expression::JSXFragment(_)
    )
}

fn recyclable_expression_is_static_primitive(expression: &Expression<'_>) -> bool {
    matches!(
        recyclable_final_expression(expression).get_inner_expression(),
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
    )
}

fn recyclable_identifier_is_static_property_name(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    parent
        .kind()
        .as_member_expression_kind()
        .is_some_and(|member| {
            member.object().span() != node.span() && member.static_property_name().is_some()
        })
}

fn recyclable_identifier_is_proven_static_callee(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut root = node;
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        let Some(member) = parent.kind().as_member_expression_kind() else {
            break;
        };
        if member.object().span() != root.span() {
            break;
        }
        root = parent;
    }
    matches!(ctx.nodes().parent_node(root.id()).kind(), AstKind::CallExpression(call)
        if call.callee.span() == root.span())
}

fn recyclable_identifier_is_comparison_operand(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut root = node;
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        let Some(member) = parent.kind().as_member_expression_kind() else {
            break;
        };
        if member.object().span() != root.span() && member.span() != root.span() {
            break;
        }
        root = parent;
    }
    matches!(ctx.nodes().parent_node(root.id()).kind(), AstKind::BinaryExpression(binary)
        if matches!(binary.operator,
            oxc_syntax::operator::BinaryOperator::Equality
                | oxc_syntax::operator::BinaryOperator::Inequality
                | oxc_syntax::operator::BinaryOperator::StrictEquality
                | oxc_syntax::operator::BinaryOperator::StrictInequality
                | oxc_syntax::operator::BinaryOperator::LessThan
                | oxc_syntax::operator::BinaryOperator::LessEqualThan
                | oxc_syntax::operator::BinaryOperator::GreaterThan
                | oxc_syntax::operator::BinaryOperator::GreaterEqualThan
                | oxc_syntax::operator::BinaryOperator::In
                | oxc_syntax::operator::BinaryOperator::Instanceof))
}

fn recyclable_symbol_is_stable_function(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::Function(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
        }
        _ => false,
    }
}

fn recyclable_collect_expression_roots<'a>(
    expression: &Expression<'a>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
    result: &mut RecyclableRenderedRoots,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) {
    let expression = recyclable_final_expression(expression);
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => {
            if recyclable_is_react_fragment_opening_element(&element.opening_element, ctx) {
                if let Some(identity) = recyclable_fragment_shape_identity(&element.children, ctx) {
                    result.identities.insert(identity);
                }
                return;
            }
            if recyclable_collect_selected_component_roots(
                &element.opening_element,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                result,
                visited_symbol_ids,
            ) {
                return;
            }
            if recyclable_collect_forwarded_component_roots(
                &element,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                result,
                visited_symbol_ids,
            ) {
                return;
            }
            if let Some(identity) = recyclable_jsx_root_identity(&element.opening_element, ctx) {
                result.identities.insert(identity);
            }
        }
        Expression::JSXFragment(fragment) => {
            if let Some(identity) = recyclable_fragment_shape_identity(&fragment.children, ctx) {
                result.identities.insert(identity);
            }
        }
        Expression::ConditionalExpression(conditional) => {
            let function_id = recyclable_nearest_function_id_for_span(
                expression.span(),
                node_ids_by_function,
                ctx,
            );
            let selector_is_input_dependent = function_id.is_some_and(|function_id| {
                node_ids_by_function
                    .get(&function_id)
                    .is_some_and(|node_ids| {
                        recyclable_selector_is_input_dependent(
                            &conditional.test,
                            input_symbol_ids,
                            node_ids,
                            ctx,
                        )
                    })
            });
            let mut consequent = RecyclableRenderedRoots::default();
            let mut alternate = RecyclableRenderedRoots::default();
            let mut consequent_visited_symbol_ids = visited_symbol_ids.clone();
            let mut alternate_visited_symbol_ids = visited_symbol_ids.clone();
            recyclable_collect_expression_roots(
                &conditional.consequent,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                &mut consequent,
                &mut consequent_visited_symbol_ids,
            );
            recyclable_collect_expression_roots(
                &conditional.alternate,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                &mut alternate,
                &mut alternate_visited_symbol_ids,
            );
            recyclable_merge_branch_roots(
                result,
                consequent,
                alternate,
                selector_is_input_dependent,
            );
        }
        Expression::LogicalExpression(logical) => {
            let function_id = recyclable_nearest_function_id_for_span(
                expression.span(),
                node_ids_by_function,
                ctx,
            );
            let selector_is_input_dependent = function_id.is_some_and(|function_id| {
                node_ids_by_function
                    .get(&function_id)
                    .is_some_and(|node_ids| {
                        recyclable_selector_is_input_dependent(
                            &logical.left,
                            input_symbol_ids,
                            node_ids,
                            ctx,
                        )
                    })
            });
            let mut left = RecyclableRenderedRoots::default();
            let mut right = RecyclableRenderedRoots::default();
            let mut left_visited_symbol_ids = visited_symbol_ids.clone();
            let mut right_visited_symbol_ids = visited_symbol_ids.clone();
            recyclable_collect_expression_roots(
                &logical.left,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                &mut left,
                &mut left_visited_symbol_ids,
            );
            recyclable_collect_expression_roots(
                &logical.right,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                &mut right,
                &mut right_visited_symbol_ids,
            );
            recyclable_merge_branch_roots(result, left, right, selector_is_input_dependent);
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return;
            }
            if let Some(initializer) =
                resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            {
                recyclable_collect_expression_roots(
                    initializer,
                    input_symbol_ids,
                    node_ids_by_function,
                    ctx,
                    result,
                    visited_symbol_ids,
                );
            }
            visited_symbol_ids.remove(&symbol_id);
        }
        Expression::CallExpression(call) => {
            if recyclable_collect_create_element_roots(
                &call,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
                result,
            ) {
                return;
            }
            let Some(called_renderer) = recyclable_resolve_called_renderer(&call, ctx) else {
                return;
            };
            let called_input_symbols = recyclable_called_input_symbols(
                &call,
                called_renderer,
                input_symbol_ids,
                node_ids_by_function,
                ctx,
            );
            if !called_input_symbols.is_empty() {
                recyclable_collect_renderer_roots(
                    called_renderer,
                    &called_input_symbols,
                    node_ids_by_function,
                    ctx,
                    result,
                    visited_symbol_ids,
                );
            }
        }
        _ => {}
    }
}

fn recyclable_collect_create_element_roots<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
    result: &mut RecyclableRenderedRoots,
) -> bool {
    if !is_react_api_call(call, "createElement", ctx) {
        return false;
    }
    let Some(component) = call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::ConditionalExpression(conditional) = component else {
        if recyclable_component_expression_is_react_fragment(component, ctx) {
            return false;
        }
        let Some(identity) = recyclable_component_expression_identity(component, ctx) else {
            return false;
        };
        result.identities.insert(identity);
        return true;
    };
    let Some(function_id) =
        recyclable_nearest_function_id_for_span(call.span, node_ids_by_function, ctx)
    else {
        return false;
    };
    let Some(indexed_node_ids) = node_ids_by_function.get(&function_id) else {
        return false;
    };
    if !recyclable_selector_is_input_dependent(
        &conditional.test,
        input_symbol_ids,
        indexed_node_ids,
        ctx,
    ) {
        return false;
    }
    if recyclable_component_expression_is_react_fragment(&conditional.consequent, ctx)
        || recyclable_component_expression_is_react_fragment(&conditional.alternate, ctx)
    {
        return false;
    }
    let Some(consequent_identity) =
        recyclable_component_expression_identity(&conditional.consequent, ctx)
    else {
        return false;
    };
    let Some(alternate_identity) =
        recyclable_component_expression_identity(&conditional.alternate, ctx)
    else {
        return false;
    };
    result.has_input_dependent_selection = true;
    result.identities.insert(consequent_identity);
    result.identities.insert(alternate_identity);
    true
}

fn recyclable_component_expression_is_react_fragment(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        recyclable_component_expression_identity(expression, ctx).as_deref(),
        Some("import:react:Fragment" | "import:react:default.Fragment")
    )
}

fn recyclable_component_expression_identity(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(format!("intrinsic:{}", literal.value)),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            symbol_id.map_or_else(
                || Some(format!("global:{}", identifier.name)),
                |symbol_id| recyclable_symbol_identity(symbol_id, identifier.name.as_str(), ctx),
            )
        }
        expression => {
            let member = expression.as_member_expression()?;
            let property_name = member.static_property_name()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            let receiver_symbol_id = ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id();
            let receiver_identity = receiver_symbol_id.map_or_else(
                || Some(format!("global:{}", receiver.name)),
                |symbol_id| recyclable_symbol_identity(symbol_id, receiver.name.as_str(), ctx),
            )?;
            (receiver_identity.starts_with("import:") || receiver_identity.starts_with("global:"))
                .then(|| format!("{receiver_identity}.{property_name}"))
        }
    }
}

fn recyclable_symbol_identity(
    symbol_id: SymbolId,
    fallback_name: &str,
    ctx: &LintContext<'_>,
) -> Option<String> {
    recyclable_symbol_identity_inner(symbol_id, fallback_name, ctx, &mut FxHashSet::default())
}

fn recyclable_symbol_identity_inner(
    symbol_id: SymbolId,
    fallback_name: &str,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    if let Some(entry) = ctx.module_record().import_entries.iter().find(|entry| {
        ctx.scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
    }) {
        let imported_name = match &entry.import_name {
            ImportImportName::Name(name) => name.name(),
            ImportImportName::Default(_) => "default",
            ImportImportName::NamespaceObject => "*",
        };
        let imported_name = if imported_name.is_empty() {
            fallback_name
        } else {
            imported_name
        };
        return Some(format!(
            "import:{}:{imported_name}",
            entry.module_request.name()
        ));
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) | AstKind::Class(_) => Some(format!("symbol:{}", symbol_id.index())),
        AstKind::VariableDeclarator(declarator) => {
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            let destructured_property_name =
                binding_property_name_for_symbol(&declarator.id, symbol_id);
            if let Expression::Identifier(alias) = initializer {
                let base_identity = ctx
                    .scoping()
                    .get_reference(alias.reference_id())
                    .symbol_id()
                    .map_or_else(
                        || Some(format!("global:{}", alias.name)),
                        |alias_symbol_id| {
                            recyclable_symbol_identity_inner(
                                alias_symbol_id,
                                alias.name.as_str(),
                                ctx,
                                visited_symbol_ids,
                            )
                        },
                    )?;
                return match destructured_property_name {
                    Some(property_name) => {
                        recyclable_append_component_member_identity(base_identity, &property_name)
                    }
                    None => Some(base_identity),
                };
            }
            if let Some(member) = initializer.as_member_expression() {
                let property_name = member.static_property_name()?;
                let Expression::Identifier(receiver) = member.object().get_inner_expression()
                else {
                    return None;
                };
                let receiver_identity = ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .map_or_else(
                        || Some(format!("global:{}", receiver.name)),
                        |receiver_symbol_id| {
                            recyclable_symbol_identity_inner(
                                receiver_symbol_id,
                                receiver.name.as_str(),
                                ctx,
                                visited_symbol_ids,
                            )
                        },
                    )?;
                return recyclable_append_component_member_identity(
                    receiver_identity,
                    property_name.as_ref(),
                );
            }
            if matches!(
                initializer,
                Expression::ArrowFunctionExpression(_)
                    | Expression::FunctionExpression(_)
                    | Expression::ClassExpression(_)
            ) || matches!(initializer, Expression::CallExpression(call)
                if is_react_api_call(call, "memo", ctx)
                    || is_react_api_call(call, "forwardRef", ctx))
            {
                return Some(format!("symbol:{}", symbol_id.index()));
            }
            None
        }
        _ => None,
    }
}

fn recyclable_append_component_member_identity(
    receiver_identity: String,
    property_name: &str,
) -> Option<String> {
    if receiver_identity.ends_with(":*") {
        return Some(format!(
            "{}{property_name}",
            receiver_identity.trim_end_matches('*')
        ));
    }
    (receiver_identity.starts_with("import:") || receiver_identity.starts_with("global:"))
        .then(|| format!("{receiver_identity}.{property_name}"))
}

fn recyclable_resolve_called_renderer(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<RecyclableRenderer> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    recyclable_renderer_for_symbol(symbol_id, ctx, &mut FxHashSet::default())
}

fn recyclable_called_input_symbols(
    call: &oxc_ast::ast::CallExpression<'_>,
    renderer: RecyclableRenderer,
    caller_input_symbols: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let parameters = match ctx.nodes().get_node(renderer.node_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return FxHashSet::default(),
    };
    let Some(caller_node_ids) =
        recyclable_nearest_function_id_for_span(call.span, node_ids_by_function, ctx)
            .and_then(|function_id| node_ids_by_function.get(&function_id))
    else {
        return FxHashSet::default();
    };
    let mut symbols = FxHashSet::default();
    for (parameter_index, parameter) in parameters.iter().enumerate() {
        let Some(argument) = call
            .arguments
            .get(parameter_index)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            continue;
        };
        if !recyclable_expression_references_symbols(
            argument,
            caller_input_symbols,
            caller_node_ids,
            ctx,
        ) {
            continue;
        }
        for node_id in node_ids_by_function
            .get(&renderer.node_id)
            .into_iter()
            .flatten()
        {
            let AstKind::BindingIdentifier(identifier) = ctx.nodes().get_node(*node_id).kind()
            else {
                continue;
            };
            if parameter.pattern.span().contains_inclusive(identifier.span) {
                symbols.insert(identifier.symbol_id());
            }
        }
    }
    symbols
}

fn recyclable_merge_branch_roots(
    result: &mut RecyclableRenderedRoots,
    left: RecyclableRenderedRoots,
    right: RecyclableRenderedRoots,
    selector_is_input_dependent: bool,
) {
    if selector_is_input_dependent {
        result.has_input_dependent_selection = true;
        result.identities.extend(left.identities);
        result.identities.extend(right.identities);
        return;
    }
    let left_is_proven_heterogeneous =
        left.has_input_dependent_selection && left.identities.len() > 1;
    let right_is_proven_heterogeneous =
        right.has_input_dependent_selection && right.identities.len() > 1;
    let branches_match = left.identities == right.identities;
    if left_is_proven_heterogeneous || right_is_proven_heterogeneous {
        result.has_input_dependent_selection = true;
        if left_is_proven_heterogeneous {
            result.identities.extend(left.identities);
        }
        if right_is_proven_heterogeneous {
            result.identities.extend(right.identities);
        }
        return;
    }
    if branches_match {
        result.identities.extend(left.identities);
    }
}

fn recyclable_collect_selected_component_roots(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
    result: &mut RecyclableRenderedRoots,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let mut selected_visited_symbol_ids = visited_symbol_ids.clone();
    selected_visited_symbol_ids.insert(symbol_id);
    let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx) else {
        return false;
    };
    let Some(function_id) =
        recyclable_nearest_function_id_for_span(opening_element.span, node_ids_by_function, ctx)
    else {
        return false;
    };
    let Some(indexed_node_ids) = node_ids_by_function.get(&function_id) else {
        return false;
    };
    let did_collect = recyclable_collect_selected_component_expression_roots(
        initializer,
        input_symbol_ids,
        indexed_node_ids,
        ctx,
        result,
        &mut selected_visited_symbol_ids,
    );
    did_collect
}

fn recyclable_collect_selected_component_expression_roots(
    expression: &Expression<'_>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    indexed_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
    result: &mut RecyclableRenderedRoots,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match recyclable_final_expression(expression).get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            if !recyclable_selector_is_input_dependent(
                &conditional.test,
                input_symbol_ids,
                indexed_node_ids,
                ctx,
            ) {
                return false;
            }
            let Some(consequent) =
                recyclable_component_expression_identity(&conditional.consequent, ctx)
            else {
                return false;
            };
            let Some(alternate) =
                recyclable_component_expression_identity(&conditional.alternate, ctx)
            else {
                return false;
            };
            result.has_input_dependent_selection = true;
            result.identities.insert(consequent);
            result.identities.insert(alternate);
            true
        }
        Expression::Identifier(alias) => {
            let Some(alias_symbol_id) = ctx
                .scoping()
                .get_reference(alias.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(alias_symbol_id) {
                return false;
            }
            let Some(alias_initializer) =
                resolve_direct_unreassigned_symbol_initializer(alias_symbol_id, ctx)
            else {
                return false;
            };
            recyclable_collect_selected_component_expression_roots(
                alias_initializer,
                input_symbol_ids,
                indexed_node_ids,
                ctx,
                result,
                visited_symbol_ids,
            )
        }
        _ => false,
    }
}

fn recyclable_collect_forwarded_component_roots(
    element: &oxc_ast::ast::JSXElement<'_>,
    input_symbol_ids: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
    result: &mut RecyclableRenderedRoots,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let JSXElementName::IdentifierReference(component_identifier) = &element.opening_element.name
    else {
        return false;
    };
    let Some(component_symbol_id) = ctx
        .scoping()
        .get_reference(component_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&component_symbol_id) {
        return false;
    }
    let mut component_visited_symbol_ids = visited_symbol_ids.clone();
    component_visited_symbol_ids.insert(component_symbol_id);
    let Some(component_renderer) =
        recyclable_renderer_for_symbol(component_symbol_id, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    let mut forwarded_property_names = FxHashSet::default();
    let Some(parent_node_ids) =
        recyclable_nearest_function_id_for_span(element.span, node_ids_by_function, ctx)
            .and_then(|function_id| node_ids_by_function.get(&function_id))
    else {
        return false;
    };
    for attribute in &element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            continue;
        };
        if get_authoritative_jsx_attribute(
            &element.opening_element,
            attribute_name.name.as_str(),
            true,
        )
        .is_none_or(|authoritative| authoritative.span != attribute.span)
        {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            continue;
        };
        let Some(expression) = container.expression.as_expression() else {
            continue;
        };
        if recyclable_expression_references_symbols(
            expression,
            input_symbol_ids,
            parent_node_ids,
            ctx,
        ) {
            forwarded_property_names.insert(attribute_name.name.to_string());
        }
    }
    if forwarded_property_names.is_empty() {
        return false;
    }
    let component_input_symbols = recyclable_component_input_symbols(
        component_renderer,
        &forwarded_property_names,
        node_ids_by_function,
        ctx,
    );
    if component_input_symbols.is_empty() {
        return false;
    }
    result.has_input_dependent_selection = true;
    recyclable_collect_renderer_roots(
        component_renderer,
        &component_input_symbols,
        node_ids_by_function,
        ctx,
        result,
        &mut component_visited_symbol_ids,
    );
    true
}

fn recyclable_renderer_for_symbol(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<RecyclableRenderer> {
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::Function(function) => Some(RecyclableRenderer {
            node_id: function.node_id.get(),
            parameters_span: function.params.span,
        }),
        AstKind::VariableDeclarator(_) => {
            let initializer = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?;
            match initializer.get_inner_expression() {
                Expression::Identifier(alias) => recyclable_renderer_for_symbol(
                    ctx.scoping()
                        .get_reference(alias.reference_id())
                        .symbol_id()?,
                    ctx,
                    visited_symbol_ids,
                ),
                Expression::CallExpression(call)
                    if is_react_api_call(call, "memo", ctx)
                        || is_react_api_call(call, "forwardRef", ctx) =>
                {
                    recyclable_resolve_renderer_expression(
                        call.arguments.first()?.as_expression()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                expression => {
                    recyclable_resolve_renderer_expression(expression, ctx, visited_symbol_ids)
                }
            }
        }
        _ => None,
    }
}

fn recyclable_component_input_symbols(
    renderer: RecyclableRenderer,
    forwarded_property_names: &FxHashSet<String>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let first_parameter = match ctx.nodes().get_node(renderer.node_id).kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    };
    let Some(first_parameter) = first_parameter else {
        return FxHashSet::default();
    };
    if let BindingPattern::BindingIdentifier(identifier) = &first_parameter.pattern {
        return if ctx
            .scoping()
            .get_resolved_references(identifier.symbol_id())
            .any(oxc_semantic::Reference::is_write)
        {
            FxHashSet::default()
        } else {
            FxHashSet::from_iter([identifier.symbol_id()])
        };
    }
    node_ids_by_function
        .get(&renderer.node_id)
        .into_iter()
        .flatten()
        .filter_map(|node_id| {
            let AstKind::BindingIdentifier(identifier) = ctx.nodes().get_node(*node_id).kind()
            else {
                return None;
            };
            let property_name =
                binding_property_name_for_symbol(&first_parameter.pattern, identifier.symbol_id())?;
            if !forwarded_property_names.contains(&property_name)
                || ctx
                    .scoping()
                    .get_resolved_references(identifier.symbol_id())
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            Some(identifier.symbol_id())
        })
        .collect()
}

fn recyclable_collect_renderer_roots(
    renderer: RecyclableRenderer,
    input_symbol_ids: &FxHashSet<SymbolId>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
    result: &mut RecyclableRenderedRoots,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) {
    let expanded_input_symbols =
        recyclable_expand_input_aliases(renderer, input_symbol_ids, node_ids_by_function, ctx);
    let renderer_node = ctx.nodes().get_node(renderer.node_id);
    if let AstKind::ArrowFunctionExpression(function) = renderer_node.kind()
        && let Some(expression) = function.get_expression()
    {
        recyclable_collect_expression_roots(
            expression,
            &expanded_input_symbols,
            node_ids_by_function,
            ctx,
            result,
            visited_symbol_ids,
        );
    }
    for node_id in node_ids_by_function
        .get(&renderer.node_id)
        .into_iter()
        .flatten()
    {
        let node = ctx.nodes().get_node(*node_id);
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if !is_node_reachable_within_function(node, renderer_node, ctx) {
            continue;
        }
        result.has_input_dependent_selection |= recyclable_return_is_input_selected(
            node,
            renderer.node_id,
            &expanded_input_symbols,
            node_ids_by_function
                .get(&renderer.node_id)
                .map_or(&[], Vec::as_slice),
            ctx,
        );
        if let Some(argument) = &statement.argument {
            recyclable_collect_expression_roots(
                argument,
                &expanded_input_symbols,
                node_ids_by_function,
                ctx,
                result,
                visited_symbol_ids,
            );
        }
    }
}

fn recyclable_final_expression<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        let Expression::SequenceExpression(sequence) = expression.get_inner_expression() else {
            return expression;
        };
        let Some(final_expression) = sequence.expressions.last() else {
            return expression;
        };
        expression = final_expression;
    }
}

fn recyclable_return_is_input_selected(
    return_node: &AstNode<'_>,
    function_id: NodeId,
    input_symbol_ids: &FxHashSet<SymbolId>,
    indexed_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(return_node.id()) {
        if ancestor.id() == function_id {
            return false;
        }
        let selector = match ancestor.kind() {
            AstKind::IfStatement(statement) => Some(&statement.test),
            AstKind::ConditionalExpression(expression) => Some(&expression.test),
            AstKind::SwitchStatement(statement) => Some(&statement.discriminant),
            _ => None,
        };
        if selector.is_some_and(|selector| {
            recyclable_selector_is_input_dependent(
                selector,
                input_symbol_ids,
                indexed_node_ids,
                ctx,
            )
        }) {
            return true;
        }
    }
    false
}

fn recyclable_nearest_function_id_for_span(
    span: Span,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    node_ids_by_function
        .keys()
        .copied()
        .filter(|function_id| {
            ctx.nodes()
                .get_node(*function_id)
                .span()
                .contains_inclusive(span)
        })
        .min_by_key(|function_id| {
            let function_span = ctx.nodes().get_node(*function_id).span();
            function_span.end - function_span.start
        })
}

fn recyclable_jsx_root_identity(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match &opening_element.name {
        JSXElementName::Identifier(identifier) => Some(format!("intrinsic:{}", identifier.name)),
        JSXElementName::IdentifierReference(identifier) => ctx
            .module_record()
            .import_entries
            .iter()
            .find(|entry| {
                ctx.scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
            })
            .map_or_else(
                || {
                    ctx.scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .map_or_else(
                            || Some(format!("global:{}", identifier.name)),
                            |symbol_id| {
                                recyclable_symbol_identity(symbol_id, identifier.name.as_str(), ctx)
                            },
                        )
                },
                |entry| {
                    let imported_name = match &entry.import_name {
                        ImportImportName::Name(name) => name.name(),
                        ImportImportName::Default(_) => "default",
                        ImportImportName::NamespaceObject => "*",
                    };
                    Some(format!(
                        "import:{}:{imported_name}",
                        entry.module_request.name()
                    ))
                },
            ),
        JSXElementName::MemberExpression(member) => match &member.object {
            oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) => ctx
                .module_record()
                .import_entries
                .iter()
                .find(|entry| {
                    matches!(entry.import_name, ImportImportName::NamespaceObject)
                        && ctx
                            .scoping()
                            .get_root_binding(entry.local_name.name().into())
                            == ctx
                                .scoping()
                                .get_reference(identifier.reference_id())
                                .symbol_id()
                })
                .map_or_else(
                    || None,
                    |entry| {
                        Some(format!(
                            "import:{}:{}",
                            entry.module_request.name(),
                            member.property.name
                        ))
                    },
                ),
            _ => None,
        },
        _ => None,
    }
}

fn recyclable_is_react_fragment_opening_element(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match &opening_element.name {
        JSXElementName::IdentifierReference(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            ctx.module_record().import_entries.iter().any(|entry| {
                entry.module_request.name() == "react"
                    && matches!(&entry.import_name,
                        ImportImportName::Name(name) if name.name() == "Fragment")
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == symbol_id
            })
        }
        JSXElementName::MemberExpression(member) => {
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(receiver) =
                &member.object
            else {
                return false;
            };
            if member.property.name != "Fragment" {
                return false;
            }
            let receiver_symbol_id = ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id();
            ctx.module_record().import_entries.iter().any(|entry| {
                entry.module_request.name() == "react"
                    && matches!(
                        entry.import_name,
                        ImportImportName::Default(_) | ImportImportName::NamespaceObject
                    )
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == receiver_symbol_id
            })
        }
        _ => false,
    }
}

fn recyclable_fragment_shape_identity(
    children: &[JSXChild<'_>],
    ctx: &LintContext<'_>,
) -> Option<String> {
    let mut child_identities = Vec::new();
    if !recyclable_append_fragment_child_identities(children, ctx, &mut child_identities) {
        return None;
    }
    match child_identities.as_slice() {
        [] => Some("empty".to_string()),
        [identity] => Some(identity.clone()),
        _ => Some(format!("fragment:[{}]", child_identities.join(","))),
    }
}

fn recyclable_append_fragment_child_identities(
    children: &[JSXChild<'_>],
    ctx: &LintContext<'_>,
    child_identities: &mut Vec<String>,
) -> bool {
    for child in children {
        match child {
            JSXChild::Element(element) => {
                if recyclable_is_react_fragment_opening_element(&element.opening_element, ctx) {
                    if !recyclable_append_fragment_child_identities(
                        &element.children,
                        ctx,
                        child_identities,
                    ) {
                        return false;
                    }
                } else if let Some(identity) =
                    recyclable_jsx_root_identity(&element.opening_element, ctx)
                {
                    child_identities.push(identity);
                } else {
                    return false;
                }
            }
            JSXChild::Fragment(fragment) => {
                if !recyclable_append_fragment_child_identities(
                    &fragment.children,
                    ctx,
                    child_identities,
                ) {
                    return false;
                }
            }
            JSXChild::Text(text) if !text.value.trim().is_empty() => {
                child_identities.push("text".to_string());
            }
            JSXChild::ExpressionContainer(container) => {
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                match recyclable_final_expression(expression).get_inner_expression() {
                    Expression::JSXElement(element) => {
                        if recyclable_is_react_fragment_opening_element(
                            &element.opening_element,
                            ctx,
                        ) {
                            if !recyclable_append_fragment_child_identities(
                                &element.children,
                                ctx,
                                child_identities,
                            ) {
                                return false;
                            }
                        } else if let Some(identity) =
                            recyclable_jsx_root_identity(&element.opening_element, ctx)
                        {
                            child_identities.push(identity);
                        } else {
                            return false;
                        }
                    }
                    Expression::JSXFragment(fragment) => {
                        if !recyclable_append_fragment_child_identities(
                            &fragment.children,
                            ctx,
                            child_identities,
                        ) {
                            return false;
                        }
                    }
                    Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => {}
                    _ => return false,
                }
            }
            JSXChild::Spread(_) => return false,
            JSXChild::Text(_) => {}
        }
    }
    true
}
