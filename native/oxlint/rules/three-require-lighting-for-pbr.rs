use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::Span;
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const LIGHT_CONSTRUCTOR_NAMES: [&str; 7] = [
    "AmbientLight",
    "DirectionalLight",
    "HemisphereLight",
    "LightProbe",
    "PointLight",
    "RectAreaLight",
    "SpotLight",
];
const PBR_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] =
    ["MeshPhysicalMaterial", "MeshStandardMaterial"];
const RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];

struct ThreeMaterialLighting {
    constructor_name: String,
    has_emissive_source: bool,
    has_environment_map: bool,
    has_light_map: bool,
    is_complete: bool,
    is_visible: bool,
    span: Span,
}

struct ThreeSceneLighting {
    has_environment: bool,
    has_light: bool,
    is_complete: bool,
    materials: Vec<ThreeMaterialLighting>,
}

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireLightingForPbr;

declare_oxc_lint!(
    /// Require a lighting source for PBR materials in closed Three.js scenes.
    ThreeRequireLightingForPbr,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require lighting for PBR materials.",
);

impl Rule for ThreeRequireLightingForPbr {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut reported_material_spans = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(render_call) = node.kind() else {
                continue;
            };
            let Some(member_expression) = render_call.callee.as_member_expression() else {
                continue;
            };
            if member_expression.static_property_name() != Some("render")
                || !three_lighting_constructor_matches(
                    member_expression.object(),
                    &RENDERER_CONSTRUCTOR_NAMES,
                    ctx,
                )
            {
                continue;
            }
            let Some(scene_expression) = render_call.arguments.first().and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(analysis) =
                analyze_closed_three_scene_lighting(scene_expression, node, ctx)
            else {
                continue;
            };
            if !analysis.is_complete || analysis.has_environment || analysis.has_light {
                continue;
            }
            for material in analysis.materials {
                if material.has_environment_map
                    || material.has_light_map
                    || material.has_emissive_source
                    || !reported_material_spans.insert(material.span)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "{} is rendered in a closed scene with no light, environment, envMap, lightMap, or emissive source",
                        material.constructor_name
                    ))
                    .with_label(material.span),
                );
            }
        }
    }
}

fn analyze_closed_three_scene_lighting<'a>(
    scene_expression: &Expression<'a>,
    render_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<ThreeSceneLighting> {
    if !three_lighting_constructor_matches(scene_expression, &["Scene"], ctx) {
        return None;
    }
    let scene_key = three_lighting_expression_key(scene_expression, ctx, &mut Vec::new())?;
    let mut analysis = ThreeSceneLighting {
        has_environment: false,
        has_light: false,
        is_complete: true,
        materials: Vec::new(),
    };
    for node in ctx.nodes().iter() {
        if !analysis.is_complete {
            break;
        }
        match node.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(target) = assignment.left.as_member_expression() else {
                    continue;
                };
                if three_lighting_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(scene_key.as_str())
                    || target.static_property_name() != Some("environment")
                {
                    continue;
                }
                if !node_dominates_node(node, render_node, ctx) {
                    analysis.is_complete = false;
                } else {
                    analysis.has_environment = !is_nullish_expression(&assignment.right);
                }
            }
            AstKind::CallExpression(call_expression) => {
                if node.id() == render_node.id() {
                    continue;
                }
                if let Some(member_expression) = call_expression.callee.as_member_expression()
                    && three_lighting_expression_key(
                        member_expression.object(),
                        ctx,
                        &mut Vec::new(),
                    )
                    .as_deref()
                        == Some(scene_key.as_str())
                {
                    if member_expression.static_property_name() != Some("add")
                        || !node_dominates_node(node, render_node, ctx)
                    {
                        analysis.is_complete = false;
                        continue;
                    }
                    analyze_three_scene_add_call(
                        call_expression,
                        node,
                        render_node,
                        ctx,
                        &mut analysis,
                    );
                    continue;
                }
                if call_expression.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|expression| {
                        three_lighting_expression_key(expression, ctx, &mut Vec::new()).as_deref()
                            == Some(scene_key.as_str())
                    })
                }) {
                    analysis.is_complete = false;
                }
            }
            _ => {}
        }
    }
    if analysis.materials.iter().any(|material| !material.is_complete) {
        analysis.is_complete = false;
    }
    Some(analysis)
}

fn analyze_three_scene_add_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    call_node: &AstNode<'a>,
    render_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    analysis: &mut ThreeSceneLighting,
) {
    for argument in &call_expression.arguments {
        let Some(expression) = argument.as_expression() else {
            analysis.is_complete = false;
            return;
        };
        let Some(constructor) = resolve_three_constructor(expression, ctx) else {
            analysis.is_complete = false;
            return;
        };
        if LIGHT_CONSTRUCTOR_NAMES.contains(&constructor.constructor_name.as_str()) {
            let Some(light) = get_static_three_light_intensity(
                expression,
                call_node,
                render_node,
                ctx,
            ) else {
                analysis.is_complete = false;
                return;
            };
            if !light.1 {
                analysis.is_complete = false;
                return;
            }
            if light.0 > 0.0 {
                analysis.has_light = true;
            }
            continue;
        }
        if constructor.constructor_name == "Mesh" {
            if !matches!(
                expression.get_inner_expression(),
                Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node)
            ) {
                analysis.is_complete = false;
                return;
            }
            let Some(material_expression) = constructor
                .node
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            if let Some(material) =
                get_static_three_pbr_material_lighting(material_expression, render_node, ctx)
                && (!material.is_complete || material.is_visible)
            {
                analysis.materials.push(material);
            }
            continue;
        }
        if !constructor.constructor_name.ends_with("Camera") {
            analysis.is_complete = false;
            return;
        }
    }
}

fn three_lighting_constructor_matches<'a>(
    expression: &Expression<'a>,
    expected_names: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    resolve_three_constructor(expression, ctx)
        .is_some_and(|constructor| expected_names.contains(&constructor.constructor_name.as_str()))
}

fn three_lighting_expression_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return Some(format!("global:{}", identifier.name));
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return Some(format!("symbol:{}", symbol_id.index()));
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                && matches!(
                    ctx.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                )
                && declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
                && let Some(initializer) = &declarator.init
                && matches!(
                    initializer.get_inner_expression(),
                    Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                        | Expression::ComputedMemberExpression(_)
                        | Expression::PrivateFieldExpression(_)
                )
                && let Some(key) =
                    three_lighting_expression_key(initializer, ctx, visited_symbol_ids)
            {
                return Some(key);
            }
            Some(format!("symbol:{}", symbol_id.index()))
        }
        expression if expression.is_member_expression() => {
            let member_expression = expression.as_member_expression()?;
            let property_name = member_expression.static_property_name()?;
            Some(format!(
                "{}.{}",
                three_lighting_expression_key(
                    member_expression.object(),
                    ctx,
                    visited_symbol_ids,
                )?,
                property_name
            ))
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        Expression::StringLiteral(literal) => Some(format!("literal:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!("literal:{}", literal.value)),
        _ => None,
    }
}

fn get_static_three_pbr_material_lighting<'a>(
    expression: &Expression<'a>,
    render_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<ThreeMaterialLighting> {
    let constructor = resolve_three_constructor(expression, ctx)?;
    if !PBR_MATERIAL_CONSTRUCTOR_NAMES.contains(&constructor.constructor_name.as_str()) {
        return None;
    }
    let mut material = ThreeMaterialLighting {
        constructor_name: constructor.constructor_name.clone(),
        has_emissive_source: false,
        has_environment_map: false,
        has_light_map: false,
        is_complete: true,
        is_visible: true,
        span: constructor.node.span,
    };
    let mut opacity = None;
    let mut is_transparent = false;
    let material_emissive_key = three_lighting_expression_key(expression, ctx, &mut Vec::new())
        .map(|material_key| format!("{material_key}.emissive"));
    if let Some(parameters) = constructor
        .node
        .arguments
        .first()
        .and_then(Argument::as_expression)
    {
        let Expression::ObjectExpression(object_expression) = parameters.get_inner_expression()
        else {
            material.is_complete = false;
            return Some(material);
        };
        if object_expression
            .properties
            .iter()
            .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
        {
            material.is_complete = false;
            return Some(material);
        }
        material.has_emissive_source = get_static_object_property_value(parameters, "emissive")
            .is_some_and(|value| !is_nullish_expression(value));
        material.has_environment_map = get_static_object_property_value(parameters, "envMap")
            .is_some_and(|value| !is_nullish_expression(value));
        material.has_light_map = get_static_object_property_value(parameters, "lightMap")
            .is_some_and(|value| !is_nullish_expression(value));
        opacity = get_static_object_property_value(parameters, "opacity")
            .and_then(|value| resolve_static_number(value, ctx));
        if let Some(value) = get_static_object_property_value(parameters, "transparent") {
            let Some(is_value_transparent) = three_lighting_static_boolean(value) else {
                material.is_complete = false;
                return Some(material);
            };
            is_transparent = is_value_transparent;
        }
        if let Some(value) = get_static_object_property_value(parameters, "visible") {
            let Some(is_value_visible) = three_lighting_static_boolean(value) else {
                material.is_complete = false;
                return Some(material);
            };
            material.is_visible = is_value_visible;
        }
    } else if !constructor.node.arguments.is_empty() {
        material.is_complete = false;
    }
    let Some(material_key) = three_lighting_expression_key(expression, ctx, &mut Vec::new()) else {
        material.is_complete = material.is_complete
            && matches!(expression.get_inner_expression(), Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node));
        material.is_visible = material.is_visible
            && !(is_transparent && opacity.is_some_and(|value| value <= 0.0));
        return Some(material);
    };
    for node in ctx.nodes().iter() {
        if !material.is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                let receiver_key = call_expression.callee.as_member_expression().and_then(
                    |member_expression| {
                        three_lighting_expression_key(
                            member_expression.object(),
                            ctx,
                            &mut Vec::new(),
                        )
                    },
                );
                let has_material_argument = call_expression.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|candidate| {
                        three_lighting_expression_key(candidate, ctx, &mut Vec::new()).as_deref()
                            == Some(material_key.as_str())
                    })
                });
                let touches_material = receiver_key.as_deref() == Some(material_key.as_str())
                    || receiver_key == material_emissive_key
                    || has_material_argument;
                if touches_material && !node_dominates_node(node, render_node, ctx) {
                    material.is_complete = false;
                    continue;
                }
                if has_material_argument {
                    material.is_complete = false;
                    continue;
                }
                if receiver_key == material_emissive_key {
                    material.has_emissive_source = true;
                } else if receiver_key.as_deref() == Some(material_key.as_str())
                    && call_expression
                        .callee
                        .as_member_expression()
                        .and_then(|member_expression| member_expression.static_property_name())
                        != Some("dispose")
                {
                    material.is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(target) = assignment.left.as_member_expression() else {
                    continue;
                };
                if three_lighting_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(material_key.as_str())
                {
                    continue;
                }
                if !node_dominates_node(node, render_node, ctx) {
                    material.is_complete = false;
                    continue;
                }
                match target.static_property_name() {
                    Some("emissive") => {
                        material.has_emissive_source = !is_nullish_expression(&assignment.right)
                    }
                    Some("envMap") => {
                        material.has_environment_map = !is_nullish_expression(&assignment.right)
                    }
                    Some("lightMap") => {
                        material.has_light_map = !is_nullish_expression(&assignment.right)
                    }
                    Some("opacity") => opacity = resolve_static_number(&assignment.right, ctx),
                    Some("transparent") => {
                        let Some(value) = three_lighting_static_boolean(&assignment.right) else {
                            material.is_complete = false;
                            continue;
                        };
                        is_transparent = value;
                    }
                    Some("visible") => {
                        let Some(value) = three_lighting_static_boolean(&assignment.right) else {
                            material.is_complete = false;
                            continue;
                        };
                        material.is_visible = value;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    material.is_visible =
        material.is_visible && !(is_transparent && opacity.is_some_and(|value| value <= 0.0));
    Some(material)
}

fn get_static_three_light_intensity<'a>(
    expression: &Expression<'a>,
    scene_add_node: &AstNode<'a>,
    render_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(f64, bool)> {
    let constructor = resolve_three_constructor(expression, ctx)?;
    let intensity_index = if constructor.constructor_name == "HemisphereLight" {
        2
    } else if LIGHT_CONSTRUCTOR_NAMES.contains(&constructor.constructor_name.as_str()) {
        1
    } else {
        return None;
    };
    let mut intensity = 1.0;
    let mut is_complete = true;
    if constructor
        .node
        .arguments
        .iter()
        .take(intensity_index + 1)
        .any(|argument| argument.as_expression().is_none())
    {
        is_complete = false;
    } else if let Some(argument) = constructor
        .node
        .arguments
        .get(intensity_index)
        .and_then(Argument::as_expression)
    {
        if let Some(value) = resolve_static_number(argument, ctx) {
            intensity = value;
        } else {
            is_complete = false;
        }
    }
    let Some(light_key) = three_lighting_expression_key(expression, ctx, &mut Vec::new()) else {
        return Some((
            intensity,
            is_complete
                && matches!(expression.get_inner_expression(), Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node)),
        ));
    };
    for node in ctx.nodes().iter() {
        if !is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                if node.id() == scene_add_node.id() {
                    continue;
                }
                let receiver_matches = call_expression
                    .callee
                    .as_member_expression()
                    .and_then(|member_expression| {
                        three_lighting_expression_key(
                            member_expression.object(),
                            ctx,
                            &mut Vec::new(),
                        )
                    })
                    .as_deref()
                    == Some(light_key.as_str());
                let argument_matches = call_expression.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|candidate| {
                        three_lighting_expression_key(candidate, ctx, &mut Vec::new()).as_deref()
                            == Some(light_key.as_str())
                    })
                });
                if receiver_matches || argument_matches {
                    is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(target) = assignment.left.as_member_expression() else {
                    continue;
                };
                if three_lighting_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(light_key.as_str())
                    || target.static_property_name() != Some("intensity")
                {
                    continue;
                }
                if !node_dominates_node(node, render_node, ctx) {
                    is_complete = false;
                } else if let Some(value) = resolve_static_number(&assignment.right, ctx) {
                    intensity = value;
                } else {
                    is_complete = false;
                }
            }
            _ => {}
        }
    }
    Some((intensity, is_complete))
}

fn three_lighting_static_boolean(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}
