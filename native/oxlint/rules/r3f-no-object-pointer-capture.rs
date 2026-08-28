use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "R3F scene objects do not implement DOM pointer capture. Call this method on event.target or event.currentTarget";
const POINTER_CAPTURE_METHODS: [&str; 3] = [
    "hasPointerCapture",
    "releasePointerCapture",
    "setPointerCapture",
];
const R3F_OBJECT_EVENT_FIELDS: [&str; 2] = ["eventObject", "object"];

#[derive(Debug, Default, Clone)]
pub struct R3FNoObjectPointerCapture;

impl RuleMeta for R3FNoObjectPointerCapture {
    const NAME: &'static str = "r3f-no-object-pointer-capture";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow pointer capture calls on R3F scene objects.",
    };
}

impl Rule for R3FNoObjectPointerCapture {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !r3f_object_pointer_capture_host_intrinsic(opening_element, ctx) {
                continue;
            }
            for attribute_item in &opening_element.attributes {
                let JSXAttributeItem::Attribute(attribute) = attribute_item else {
                    continue;
                };
                let attribute_name = r3f_object_pointer_capture_attribute_name(&attribute.name);
                if !attribute_name.starts_with("onPointer")
                    || get_authoritative_jsx_attribute(opening_element, &attribute_name, true)
                        .is_none_or(|authoritative_attribute| {
                            !std::ptr::eq(authoritative_attribute, attribute.as_ref())
                        })
                {
                    continue;
                }
                let Some(handler_expression) = jsx_attribute_expression(attribute) else {
                    continue;
                };
                let Some(handler_id) = resolve_r3f_analyzed_callback_function_id(
                    handler_expression,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                ) else {
                    continue;
                };
                if matches!(
                    ctx.nodes().get_node(handler_id).kind(),
                    AstKind::Function(function) if function.generator
                ) {
                    continue;
                }
                for_each_analyzed_synchronous_execution_node(
                    handler_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    |candidate, root_handler_id, _, _| {
                        let AstKind::CallExpression(call_expression) = candidate.kind() else {
                            return;
                        };
                        let Some(member_expression) = call_expression.callee.as_member_expression()
                        else {
                            return;
                        };
                        if static_member_expression_property_name(member_expression).is_some_and(
                            |method_name| POINTER_CAPTURE_METHODS.contains(&method_name),
                        ) && r3f_pointer_capture_receiver_is_event_object(
                            member_expression.object(),
                            root_handler_id,
                            ctx,
                        ) {
                            ctx.diagnostic(
                                OxcDiagnostic::error(MESSAGE).with_label(candidate.span()),
                            );
                        }
                    },
                );
            }
        }
    }
}

fn r3f_object_pointer_capture_host_intrinsic<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return false;
    };
    element_type
        .chars()
        .next()
        .is_some_and(|first_character| first_character.is_lowercase())
        && !crate::globals::HTML_TAG.contains(element_type)
        && (!is_svg_tag_name(element_type) || element_type == "line")
}

fn r3f_object_pointer_capture_attribute_name(attribute_name: &JSXAttributeName<'_>) -> String {
    match attribute_name {
        JSXAttributeName::Identifier(identifier) => identifier.name.to_string(),
        JSXAttributeName::NamespacedName(namespaced_name) => format!(
            "{}:{}",
            namespaced_name.namespace.name, namespaced_name.name.name
        ),
    }
}

fn r3f_pointer_capture_receiver_is_event_object<'a>(
    expression: &Expression<'a>,
    handler_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        if R3F_OBJECT_EVENT_FIELDS.iter().any(|property_name| {
            r3f_callback_parameter_property_symbol_matches(
                handler_id,
                symbol_id,
                property_name,
                ctx,
            )
        }) {
            return true;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        if !matches!(declaration.kind(), AstKind::VariableDeclarator(_))
            || !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            )
        {
            return false;
        }
    }
    R3F_OBJECT_EVENT_FIELDS.iter().any(|property_name| {
        r3f_callback_state_property_matches(expression, handler_id, property_name, ctx)
    })
}
