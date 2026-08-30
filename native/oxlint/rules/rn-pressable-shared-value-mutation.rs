use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const PRESS_HANDLER_PROP_NAMES: [&str; 4] = ["onPress", "onPressIn", "onPressOut", "onLongPress"];
const PRESSABLE_ELEMENT_NAMES: [&str; 5] = [
    "Pressable",
    "TouchableOpacity",
    "TouchableHighlight",
    "TouchableWithoutFeedback",
    "TouchableNativeFeedback",
];

#[derive(Debug, Default, Clone)]
pub struct RnPressableSharedValueMutation;

#[derive(Default)]
struct PressableSharedValueIndex {
    bindings_by_function: FxHashMap<NodeId, Vec<(u32, String)>>,
    mutation_receivers_by_function: FxHashMap<NodeId, FxHashSet<String>>,
}

declare_oxc_lint!(
    /// Warns when a React Native press handler mutates a Reanimated shared value.
    RnPressableSharedValueMutation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Pressable animates on the JS thread.",
);

impl Rule for RnPressableSharedValueMutation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let shared_value_index = pressable_build_shared_value_index(ctx);
        if shared_value_index.bindings_by_function.is_empty() {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some(element_name) = resolve_jsx_element_name(opening_element) else {
                continue;
            };
            if !PRESSABLE_ELEMENT_NAMES.contains(&element_name) {
                continue;
            }
            let shared_value_binding_names =
                pressable_active_shared_value_binding_names(node, &shared_value_index, ctx);
            if shared_value_binding_names.is_empty() {
                continue;
            }
            for attribute in &opening_element.attributes {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    continue;
                };
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    continue;
                };
                if !PRESS_HANDLER_PROP_NAMES.contains(&attribute_name.name.as_str()) {
                    continue;
                }
                let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                else {
                    continue;
                };
                let Some(handler) = container.expression.as_expression() else {
                    continue;
                };
                let handler_function_id = match handler {
                    Expression::ArrowFunctionExpression(function) => function.node_id.get(),
                    Expression::FunctionExpression(function) => function.node_id.get(),
                    _ => continue,
                };
                if !shared_value_index
                    .mutation_receivers_by_function
                    .get(&handler_function_id)
                    .is_some_and(|mutation_receivers| {
                        shared_value_binding_names
                            .iter()
                            .any(|binding_name| mutation_receivers.contains(*binding_name))
                    })
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Your users feel a choppy press when <{element_name}> {} animates on the JS thread.",
                        attribute_name.name
                    ))
                    .with_label(attribute.span),
                );
            }
        }
    }
}

fn pressable_build_shared_value_index(ctx: &LintContext<'_>) -> PressableSharedValueIndex {
    let mut index = PressableSharedValueIndex::default();
    for candidate in ctx.nodes().iter() {
        if let AstKind::VariableDeclarator(declarator) = candidate.kind()
            && let BindingPattern::BindingIdentifier(binding) = &declarator.id
            && let Some(Expression::CallExpression(call)) = declarator.init.as_ref()
            && matches!(&call.callee, Expression::Identifier(callee) if callee.name == "useSharedValue")
            && let Some(function_id) = pressable_nearest_function_id(candidate, ctx)
        {
            index
                .bindings_by_function
                .entry(function_id)
                .or_default()
                .push((candidate.span().start, binding.name.to_string()));
        }
        let Some(receiver_name) = pressable_shared_value_mutation_receiver(candidate) else {
            continue;
        };
        for function_id in ctx
            .nodes()
            .ancestors(candidate.id())
            .filter(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .map(AstNode::id)
        {
            index
                .mutation_receivers_by_function
                .entry(function_id)
                .or_default()
                .insert(receiver_name.to_string());
        }
    }
    index
}

fn pressable_active_shared_value_binding_names<'a>(
    opening_node: &AstNode<'_>,
    index: &'a PressableSharedValueIndex,
    ctx: &LintContext<'_>,
) -> FxHashSet<&'a str> {
    let opening_offset = opening_node.span().start;
    ctx.nodes()
        .ancestors(opening_node.id())
        .filter_map(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
            .then(|| index.bindings_by_function.get(&ancestor.id()))
            .flatten()
        })
        .flatten()
        .filter_map(|(binding_offset, binding_name)| {
            (*binding_offset < opening_offset).then_some(binding_name.as_str())
        })
        .collect()
}

fn pressable_nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn pressable_shared_value_mutation_receiver<'a>(candidate: &AstNode<'a>) -> Option<&'a str> {
    let member_expression = match candidate.kind() {
        AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression(),
        AstKind::CallExpression(call) => call.callee.as_member_expression(),
        _ => None,
    }?;
    let Expression::Identifier(receiver) = member_expression.object() else {
        return None;
    };
    let property_name = member_expression_identifier_property_name(member_expression)?;
    match candidate.kind() {
        AstKind::AssignmentExpression(_) if property_name == "value" => {
            Some(receiver.name.as_str())
        }
        AstKind::CallExpression(_) if matches!(property_name, "set" | "value") => {
            Some(receiver.name.as_str())
        }
        _ => None,
    }
}
