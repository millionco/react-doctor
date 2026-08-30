use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, CallExpression, Expression, JSXChild, JSXElementName,
        JSXMemberExpression, JSXMemberExpressionObject, MemberExpression,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const RN_SCROLLVIEW_ARRAY_ITERATION_METHODS: [&str; 3] = ["map", "flatMap", "reduce"];
const RN_SCROLLVIEW_LENGTH_PRESERVING_METHODS: [&str; 5] =
    ["fill", "slice", "filter", "sort", "reverse"];
const RN_SCROLLVIEW_EXPO_UI_MODULE_SOURCES: [&str; 3] =
    ["@expo/ui", "@expo/ui/swift-ui", "@expo/ui/jetpack-compose"];
const RN_SCROLLVIEW_SHORT_FIXED_LIST_MAX_ROW_COUNT: f64 = 10.0;
const RN_SCROLLVIEW_STATIC_LENGTH_MAX_DEPTH: usize = 8;

#[derive(Debug, Default, Clone)]
pub struct RnNoScrollviewMappedList;

declare_oxc_lint!(
    /// Warns when a ScrollView directly renders an unbounded mapped list.
    RnNoScrollviewMappedList,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a ScrollView directly renders an unbounded mapped list.",
);

impl Rule for RnNoScrollviewMappedList {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let jsx_row_builder_spans = rn_scrollview_jsx_row_builder_spans(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            if resolve_jsx_element_name(&element.opening_element) != Some("ScrollView")
                || rn_scrollview_is_expo_ui_component(&element.opening_element, ctx)
            {
                continue;
            }
            for child in &element.children {
                let JSXChild::ExpressionContainer(container) = child else {
                    continue;
                };
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                if !rn_scrollview_is_array_iteration_expression(expression, &jsx_row_builder_spans)
                {
                    continue;
                }
                if let Expression::CallExpression(call_expression) = expression
                    && rn_scrollview_is_short_fixed_length_map(call_expression, ctx)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(
                        "Your users get slow scrolling when <ScrollView> with items.map(...) builds every row at once.",
                    )
                    .with_label(container.span),
                );
                break;
            }
        }
    }
}

fn rn_scrollview_is_array_iteration_expression(
    expression: &Expression<'_>,
    jsx_row_builder_spans: &FxHashSet<(u32, u32)>,
) -> bool {
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    let Some(method_name) = rn_scrollview_call_method_name(call_expression) else {
        return false;
    };
    if method_name == "reduce" {
        return rn_scrollview_reduce_builds_jsx_rows(call_expression, jsx_row_builder_spans);
    }
    if RN_SCROLLVIEW_ARRAY_ITERATION_METHODS.contains(&method_name) {
        return true;
    }
    if matches!(
        method_name,
        "filter" | "slice" | "sort" | "reverse" | "concat"
    ) {
        return rn_scrollview_call_receiver(call_expression).is_some_and(|receiver| {
            rn_scrollview_is_array_iteration_expression(receiver, jsx_row_builder_spans)
        });
    }
    false
}

fn rn_scrollview_call_method_name<'a>(call_expression: &'a CallExpression<'a>) -> Option<&'a str> {
    call_expression
        .callee
        .as_member_expression()
        .and_then(member_expression_identifier_property_name)
}

fn rn_scrollview_call_receiver<'a>(
    call_expression: &'a CallExpression<'a>,
) -> Option<&'a Expression<'a>> {
    call_expression
        .callee
        .as_member_expression()
        .map(MemberExpression::object)
}

fn rn_scrollview_reduce_builds_jsx_rows(
    call_expression: &CallExpression<'_>,
    jsx_row_builder_spans: &FxHashSet<(u32, u32)>,
) -> bool {
    let Some(row_builder) = call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if !matches!(
        row_builder,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let row_builder_span = row_builder.span();
    jsx_row_builder_spans.contains(&(row_builder_span.start, row_builder_span.end))
}

fn rn_scrollview_jsx_row_builder_spans(ctx: &LintContext<'_>) -> FxHashSet<(u32, u32)> {
    let mut row_builder_spans = FxHashSet::default();
    for jsx_element in ctx
        .nodes()
        .iter()
        .filter(|candidate| matches!(candidate.kind(), AstKind::JSXElement(_)))
    {
        for ancestor in ctx.nodes().ancestors(jsx_element.id()) {
            if matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                let span = ancestor.span();
                row_builder_spans.insert((span.start, span.end));
            }
        }
    }
    row_builder_spans
}

fn rn_scrollview_is_short_fixed_length_map<'a>(
    call_expression: &'a CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    rn_scrollview_call_method_name(call_expression) == Some("map")
        && rn_scrollview_call_receiver(call_expression).is_some_and(|receiver| {
            rn_scrollview_static_max_array_length(receiver, 0, ctx)
                .is_some_and(|length| length <= RN_SCROLLVIEW_SHORT_FIXED_LIST_MAX_ROW_COUNT)
        })
}

fn rn_scrollview_static_max_array_length<'a>(
    expression: &Expression<'a>,
    resolution_depth: usize,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    if resolution_depth > RN_SCROLLVIEW_STATIC_LENGTH_MAX_DEPTH {
        return None;
    }
    match expression {
        Expression::ArrayExpression(array_expression) => {
            if array_expression
                .elements
                .iter()
                .any(|element| matches!(element, ArrayExpressionElement::SpreadElement(_)))
            {
                return None;
            }
            Some(array_expression.elements.len() as f64)
        }
        Expression::CallExpression(call_expression) => {
            if let Some(length) = rn_scrollview_static_array_constructor_length(
                &call_expression.callee,
                &call_expression.arguments,
            ) {
                return Some(length);
            }
            let member_expression = call_expression.callee.as_member_expression()?;
            let method_name = member_expression_identifier_property_name(member_expression)?;
            if !RN_SCROLLVIEW_LENGTH_PRESERVING_METHODS.contains(&method_name) {
                return None;
            }
            rn_scrollview_static_max_array_length(
                member_expression.object(),
                resolution_depth + 1,
                ctx,
            )
        }
        Expression::NewExpression(new_expression) => rn_scrollview_static_array_constructor_length(
            &new_expression.callee,
            &new_expression.arguments,
        ),
        Expression::ConditionalExpression(conditional_expression) => {
            let consequent_length = rn_scrollview_static_max_array_length(
                &conditional_expression.consequent,
                resolution_depth + 1,
                ctx,
            )?;
            let alternate_length = rn_scrollview_static_max_array_length(
                &conditional_expression.alternate,
                resolution_depth + 1,
                ctx,
            )?;
            Some(consequent_length.max(alternate_length))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
            {
                return None;
            }
            let base_initializer = declarator
                .id
                .get_binding_identifier()
                .filter(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
                .and(declarator.init.as_ref());
            let initializer = binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                base_initializer,
            )?;
            rn_scrollview_static_max_array_length(initializer, resolution_depth + 1, ctx)
        }
        _ => None,
    }
}

fn rn_scrollview_static_array_constructor_length(
    callee: &Expression<'_>,
    arguments: &[Argument<'_>],
) -> Option<f64> {
    if !matches!(callee, Expression::Identifier(identifier) if identifier.name == "Array")
        || arguments.len() != 1
    {
        return None;
    }
    match &arguments[0] {
        Argument::NumericLiteral(length) => Some(length.value),
        _ => None,
    }
}

fn rn_scrollview_is_expo_ui_component<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((root_name, second_name)) =
        rn_scrollview_jsx_root_and_second_name(&opening_element.name)
    else {
        return false;
    };
    if rn_scrollview_textual_import(root_name, ctx).is_some_and(|entry| {
        RN_SCROLLVIEW_EXPO_UI_MODULE_SOURCES.contains(&entry.module_request.name())
            && matches!(&entry.import_name, ImportImportName::Name(imported_name) if imported_name.name() == "ScrollView")
    }) {
        return true;
    }
    second_name == Some("ScrollView")
        && rn_scrollview_textual_import(root_name, ctx).is_some_and(|entry| {
            RN_SCROLLVIEW_EXPO_UI_MODULE_SOURCES.contains(&entry.module_request.name())
                && matches!(entry.import_name, ImportImportName::NamespaceObject)
        })
}

fn rn_scrollview_textual_import<'a, 'b>(
    local_name: &str,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::module_record::ImportEntry> {
    ctx.module_record()
        .import_entries
        .iter()
        .find(|entry| entry.local_name.name() == local_name)
}

fn rn_scrollview_jsx_root_and_second_name<'a>(
    element_name: &'a JSXElementName<'a>,
) -> Option<(&'a str, Option<&'a str>)> {
    match element_name {
        JSXElementName::Identifier(identifier) => Some((identifier.name.as_str(), None)),
        JSXElementName::IdentifierReference(identifier) => Some((identifier.name.as_str(), None)),
        JSXElementName::MemberExpression(member_expression) => {
            rn_scrollview_jsx_member_root_and_second_name(member_expression)
                .map(|(root_name, second_name)| (root_name, Some(second_name)))
        }
        _ => None,
    }
}

fn rn_scrollview_jsx_member_root_and_second_name<'a>(
    member_expression: &'a JSXMemberExpression<'a>,
) -> Option<(&'a str, &'a str)> {
    match &member_expression.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => Some((
            identifier.name.as_str(),
            member_expression.property.name.as_str(),
        )),
        JSXMemberExpressionObject::MemberExpression(parent_member) => {
            rn_scrollview_jsx_member_root_and_second_name(parent_member)
        }
        JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}
