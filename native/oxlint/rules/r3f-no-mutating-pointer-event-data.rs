use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, MemberExpression, SimpleAssignmentTarget},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_POINTER_EVENT_NAMES: [&str; 12] = [
    "onClick",
    "onContextMenu",
    "onDoubleClick",
    "onPointerCancel",
    "onPointerDown",
    "onPointerEnter",
    "onPointerLeave",
    "onPointerMove",
    "onPointerOut",
    "onPointerOver",
    "onPointerUp",
    "onWheel",
];
const R3F_POINTER_EVENT_MUTATING_VECTOR_METHOD_NAMES: [&str; 59] = [
    "add",
    "addScalar",
    "addScaledVector",
    "addVectors",
    "applyAxisAngle",
    "applyEuler",
    "applyMatrix3",
    "applyMatrix4",
    "applyNormalMatrix",
    "applyQuaternion",
    "ceil",
    "clamp",
    "clampLength",
    "clampScalar",
    "copy",
    "cross",
    "crossVectors",
    "divide",
    "divideScalar",
    "floor",
    "fromArray",
    "lerp",
    "lerpVectors",
    "max",
    "min",
    "multiply",
    "multiplyScalar",
    "multiplyVectors",
    "negate",
    "normalize",
    "project",
    "projectOnPlane",
    "projectOnVector",
    "random",
    "randomDirection",
    "reflect",
    "round",
    "roundToZero",
    "set",
    "setFromColor",
    "setFromCylindrical",
    "setFromCylindricalCoords",
    "setFromEuler",
    "setFromMatrix3Column",
    "setFromMatrixColumn",
    "setFromMatrixPosition",
    "setFromMatrixScale",
    "setFromSpherical",
    "setFromSphericalCoords",
    "setLength",
    "setScalar",
    "setX",
    "setY",
    "setZ",
    "sub",
    "subScalar",
    "subVectors",
    "transformDirection",
    "unproject",
];
const R3F_POINTER_EVENT_MUTATING_VECTOR_ARGUMENT_METHOD_NAMES: [&str; 2] =
    ["localToWorld", "worldToLocal"];
const R3F_POINTER_EVENT_SHARED_VECTOR_NAMES: [&str; 4] = ["normal", "point", "ray", "uv"];
const R3F_POINTER_EVENT_MUTATION_MESSAGE: &str = "This mutates pointer-event hit data supplied by R3F. Copy it into an owned vector or ray before changing it";

#[derive(Debug, Default, Clone)]
pub struct R3FNoMutatingPointerEventData;

impl RuleMeta for R3FNoMutatingPointerEventData {
    const NAME: &'static str = "r3f-no-mutating-pointer-event-data";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Mutation of shared R3F pointer-event data",
    };
}

impl Rule for R3FNoMutatingPointerEventData {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_r3f_runtime_import(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut reported_node_ids = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            for event_name in R3F_POINTER_EVENT_NAMES {
                let Some(handler_expression) =
                    r3f_jsx_event_handler_expression(opening_element, event_name, ctx)
                else {
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
                        let Some(mutated_span) =
                            r3f_pointer_event_mutated_span(candidate, root_handler_id, ctx)
                        else {
                            return;
                        };
                        if reported_node_ids.insert(candidate.id()) {
                            ctx.diagnostic(
                                OxcDiagnostic::warn(R3F_POINTER_EVENT_MUTATION_MESSAGE)
                                    .with_label(mutated_span),
                            );
                        }
                    },
                );
            }
        }
    }
}

fn r3f_pointer_event_mutated_span<'a>(
    candidate: &crate::AstNode<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    match candidate.kind() {
        AstKind::AssignmentExpression(assignment) => {
            r3f_pointer_event_assignment_target_mutated_span(&assignment.left, handler_id, ctx)
        }
        AstKind::UpdateExpression(update) => {
            r3f_pointer_event_simple_assignment_target_mutated_span(
                &update.argument,
                handler_id,
                ctx,
            )
        }
        AstKind::CallExpression(call) => r3f_pointer_event_call_mutated_span(call, handler_id, ctx),
        _ => None,
    }
}

fn r3f_pointer_event_assignment_target_mutated_span<'a>(
    target: &AssignmentTarget<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            r3f_pointer_event_identifier_symbol_matches_shared_vector(
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?,
                handler_id,
                ctx,
            )
            .then_some(identifier.span)
        }
        _ => r3f_pointer_event_member_or_descendant_is_shared(
            target.as_member_expression()?,
            handler_id,
            ctx,
        )
        .then(|| target.span()),
    }
}

fn r3f_pointer_event_simple_assignment_target_mutated_span<'a>(
    target: &SimpleAssignmentTarget<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    match target {
        SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            r3f_pointer_event_identifier_symbol_matches_shared_vector(
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?,
                handler_id,
                ctx,
            )
            .then_some(identifier.span)
        }
        _ => r3f_pointer_event_member_or_descendant_is_shared(
            target.as_member_expression()?,
            handler_id,
            ctx,
        )
        .then(|| target.span()),
    }
}

fn r3f_pointer_event_call_mutated_span<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    let member_expression = call.callee.get_inner_expression().as_member_expression()?;
    let method_name = static_member_expression_property_name(member_expression)?;
    if R3F_POINTER_EVENT_MUTATING_VECTOR_METHOD_NAMES.contains(&method_name)
        && r3f_pointer_event_expression_is_shared_or_descendant(
            member_expression.object(),
            handler_id,
            ctx,
        )
    {
        return Some(member_expression.object().span());
    }
    if !R3F_POINTER_EVENT_MUTATING_VECTOR_ARGUMENT_METHOD_NAMES.contains(&method_name) {
        return None;
    }
    call.arguments.iter().find_map(|argument| {
        let expression = argument.as_expression()?;
        r3f_pointer_event_expression_is_shared_or_descendant(expression, handler_id, ctx)
            .then(|| expression.span())
    })
}

fn r3f_pointer_event_member_or_descendant_is_shared<'a>(
    member_expression: &MemberExpression<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let is_direct_shared_property =
        R3F_POINTER_EVENT_SHARED_VECTOR_NAMES
            .iter()
            .any(|property_name| {
                r3f_pointer_event_member_property_matches(member_expression, property_name)
                    && r3f_resolves_to_callback_state(
                        member_expression.object(),
                        handler_id,
                        ctx,
                        &mut Vec::new(),
                    )
            });
    is_direct_shared_property
        || r3f_pointer_event_expression_is_shared_or_descendant(
            member_expression.object(),
            handler_id,
            ctx,
        )
}

fn r3f_pointer_event_expression_is_shared_or_descendant<'a>(
    expression: &Expression<'a>,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut candidate = expression.get_inner_expression();
    loop {
        if R3F_POINTER_EVENT_SHARED_VECTOR_NAMES
            .iter()
            .any(|property_name| {
                r3f_pointer_event_callback_state_property_matches(
                    candidate,
                    handler_id,
                    property_name,
                    ctx,
                )
            })
        {
            return true;
        }
        let Some(member_expression) = candidate.as_member_expression() else {
            return false;
        };
        candidate = member_expression.object().get_inner_expression();
    }
}

fn r3f_pointer_event_callback_state_property_matches<'a>(
    expression: &Expression<'a>,
    handler_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    r3f_pointer_event_callback_state_property_matches_inner(
        expression,
        handler_id,
        property_name,
        ctx,
        &mut Vec::new(),
    )
}

fn r3f_pointer_event_callback_state_property_matches_inner<'a>(
    expression: &Expression<'a>,
    handler_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return r3f_pointer_event_member_property_matches(member_expression, property_name)
            && r3f_resolves_to_callback_state(
                member_expression.object(),
                handler_id,
                ctx,
                visited_symbol_ids,
            );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if r3f_pointer_event_callback_parameter_property_symbol_matches(
        handler_id,
        symbol_id,
        property_name,
        ctx,
    ) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if !ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
        && matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        )
        && let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && r3f_binding_pattern_symbol_id(&declarator.id) == Some(symbol_id)
    {
        visited_symbol_ids.push(symbol_id);
        if declarator.init.as_ref().is_some_and(|initializer| {
            r3f_pointer_event_callback_state_property_matches_inner(
                initializer,
                handler_id,
                property_name,
                ctx,
                visited_symbol_ids,
            )
        }) {
            return true;
        }
    }
    r3f_pointer_event_destructured_symbol_matches_callback_property(
        symbol_id,
        handler_id,
        property_name,
        ctx,
        visited_symbol_ids,
    )
}

fn r3f_pointer_event_identifier_symbol_matches_shared_vector(
    symbol_id: SymbolId,
    handler_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    R3F_POINTER_EVENT_SHARED_VECTOR_NAMES
        .iter()
        .any(|property_name| {
            r3f_pointer_event_callback_parameter_property_symbol_matches(
                handler_id,
                symbol_id,
                property_name,
                ctx,
            ) || r3f_pointer_event_destructured_symbol_matches_callback_property(
                symbol_id,
                handler_id,
                property_name,
                ctx,
                &mut Vec::new(),
            )
        })
}

fn r3f_pointer_event_callback_parameter_property_symbol_matches(
    handler_id: NodeId,
    symbol_id: SymbolId,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let parameter = r3f_unwrap_assignment_pattern(r3f_callback_first_parameter(handler_id, ctx));
    let Some(oxc_ast::ast::BindingPattern::ObjectPattern(pattern)) = parameter else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        r3f_pointer_event_property_key_matches(&property.key, property.computed, property_name)
            && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    })
}

fn r3f_pointer_event_destructured_symbol_matches_callback_property(
    symbol_id: SymbolId,
    handler_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        r3f_pointer_event_property_key_matches(&property.key, property.computed, property_name)
            && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        r3f_resolves_to_callback_state(
            initializer,
            handler_id,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
    })
}

fn r3f_pointer_event_member_property_matches(
    member_expression: &MemberExpression<'_>,
    property_name: &str,
) -> bool {
    static_member_expression_property_name(member_expression)
        .is_some_and(|candidate| candidate == property_name)
}

fn r3f_pointer_event_property_key_matches(
    property_key: &oxc_ast::ast::PropertyKey<'_>,
    is_computed: bool,
    property_name: &str,
) -> bool {
    if is_computed {
        return match property_key {
            oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value == property_name,
            oxc_ast::ast::PropertyKey::TemplateLiteral(template)
                if template.expressions.is_empty() =>
            {
                template.quasis.first().is_some_and(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                        == property_name
                })
            }
            _ => false,
        };
    }
    property_key_matches_name(property_key, property_name)
}
