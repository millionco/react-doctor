use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, UnaryOperator};
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
const PBR_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] = ["MeshPhysicalMaterial", "MeshStandardMaterial"];
const RENDERER_CONSTRUCTOR_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_LIGHTING_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const METAL_ENVIRONMENT_THRESHOLD: f64 = 0.5;

struct ThreeMaterialLighting {
    constructor_name: String,
    has_environment_map: bool,
    is_complete: bool,
    is_visible: bool,
    metalness: Option<f64>,
    node_id: NodeId,
    span: Span,
}

struct ThreeSceneLighting {
    has_environment: bool,
    is_complete: bool,
    materials: Vec<ThreeMaterialLighting>,
}

struct ThreeLightingConstructor<'a, 'b> {
    constructor_name: String,
    node: &'b oxc_ast::ast::NewExpression<'a>,
}

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireEnvironmentForMetal;

declare_oxc_lint!(
    /// Require environment lighting for strongly metallic materials in closed Three.js scenes.
    ThreeRequireEnvironmentForMetal,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require environment lighting for metallic materials.",
);

impl Rule for ThreeRequireEnvironmentForMetal {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if !ctx.nodes().iter().any(|node| {
            matches!(
                node.kind(),
                AstKind::CallExpression(call_expression)
                    if call_expression
                        .callee
                        .as_member_expression()
                        .and_then(three_lighting_static_member_property_name)
                        == Some("render")
            )
        }) {
            return;
        }
        let static_property_write_analysis = build_possible_static_property_write_analysis(ctx);
        let mut reported_material_ids = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(render_call) = node.kind() else {
                continue;
            };
            let Some(member_expression) = render_call.callee.as_member_expression() else {
                continue;
            };
            if three_lighting_static_member_property_name(member_expression) != Some("render")
                || !three_lighting_constructor_matches(
                    member_expression.object(),
                    &RENDERER_CONSTRUCTOR_NAMES,
                    &static_property_write_analysis,
                    ctx,
                )
            {
                continue;
            }
            let Some(scene_expression) = render_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(analysis) = analyze_closed_three_scene_lighting(
                scene_expression,
                node,
                &static_property_write_analysis,
                ctx,
            ) else {
                continue;
            };
            if !analysis.is_complete || analysis.has_environment {
                continue;
            }
            for material in analysis.materials {
                let Some(metalness) = material.metalness else {
                    continue;
                };
                if material.has_environment_map
                    || metalness <= METAL_ENVIRONMENT_THRESHOLD
                    || !reported_material_ids.insert(material.node_id)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "{} uses metalness {} without an envMap or rendered scene environment, so its reflections have no environment source",
                        material.constructor_name,
                        format_javascript_number(metalness)
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
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeSceneLighting> {
    if !three_lighting_constructor_matches(
        scene_expression,
        &["Scene"],
        static_property_write_analysis,
        ctx,
    ) {
        return None;
    }
    let scene_key = three_lighting_expression_key(scene_expression, ctx, &mut Vec::new())?;
    let mut analysis = ThreeSceneLighting {
        has_environment: false,
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
                let Some(target) = assignment.left.as_member_expression().or_else(|| {
                    assignment
                        .left
                        .get_expression()?
                        .get_inner_expression()
                        .as_member_expression()
                }) else {
                    continue;
                };
                if three_lighting_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(scene_key.as_str())
                    || three_lighting_static_member_property_name(target) != Some("environment")
                {
                    continue;
                }
                if !node_dominates_node(node, render_node, ctx) {
                    analysis.is_complete = false;
                } else {
                    analysis.has_environment =
                        !three_lighting_is_nullish_expression(&assignment.right);
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
                    if three_lighting_static_member_property_name(member_expression) != Some("add")
                        || !node_dominates_node(node, render_node, ctx)
                    {
                        analysis.is_complete = false;
                        continue;
                    }
                    analyze_three_scene_add_call(
                        call_expression,
                        node,
                        render_node,
                        static_property_write_analysis,
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
    if analysis
        .materials
        .iter()
        .any(|material| !material.is_complete)
    {
        analysis.is_complete = false;
    }
    Some(analysis)
}

fn analyze_three_scene_add_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    call_node: &AstNode<'a>,
    render_node: &AstNode<'a>,
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    analysis: &mut ThreeSceneLighting,
) {
    for argument in &call_expression.arguments {
        let Some(expression) = argument.as_expression() else {
            analysis.is_complete = false;
            return;
        };
        let Some(constructor) =
            resolve_three_lighting_constructor(expression, static_property_write_analysis, ctx)
        else {
            analysis.is_complete = false;
            return;
        };
        if LIGHT_CONSTRUCTOR_NAMES.contains(&constructor.constructor_name.as_str()) {
            let Some((_, is_light_complete)) = get_static_three_light_intensity(
                expression,
                call_node,
                render_node,
                static_property_write_analysis,
                ctx,
            ) else {
                analysis.is_complete = false;
                return;
            };
            if !is_light_complete {
                analysis.is_complete = false;
                return;
            }
            continue;
        }
        if constructor.constructor_name == "Mesh" {
            if !matches!(
                three_lighting_strip_parentheses(expression),
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
            if let Some(material) = get_static_three_pbr_material_lighting(
                material_expression,
                render_node,
                static_property_write_analysis,
                ctx,
            ) && (!material.is_complete || material.is_visible)
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
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_three_lighting_constructor(expression, static_property_write_analysis, ctx)
        .is_some_and(|constructor| expected_names.contains(&constructor.constructor_name.as_str()))
}

fn get_static_three_pbr_material_lighting<'a>(
    expression: &Expression<'a>,
    render_node: &AstNode<'a>,
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeMaterialLighting> {
    let constructor =
        resolve_three_lighting_constructor(expression, static_property_write_analysis, ctx)?;
    if !PBR_MATERIAL_CONSTRUCTOR_NAMES.contains(&constructor.constructor_name.as_str()) {
        return None;
    }
    let mut material = ThreeMaterialLighting {
        constructor_name: constructor.constructor_name.clone(),
        has_environment_map: false,
        is_complete: true,
        is_visible: true,
        metalness: None,
        node_id: constructor.node.node_id(),
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
        let Expression::ObjectExpression(object_expression) =
            three_lighting_strip_parentheses(parameters)
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
        material.has_environment_map =
            three_lighting_static_object_property_value(parameters, "envMap")
                .is_some_and(|value| !three_lighting_is_nullish_expression(value));
        material.metalness = three_lighting_static_object_property_value(parameters, "metalness")
            .and_then(|value| three_lighting_static_number(value, ctx));
        opacity = three_lighting_static_object_property_value(parameters, "opacity")
            .and_then(|value| three_lighting_static_number(value, ctx));
        if let Some(value) = three_lighting_static_object_property_value(parameters, "transparent")
        {
            let Some(is_value_transparent) = three_lighting_static_boolean(value) else {
                material.is_complete = false;
                return Some(material);
            };
            is_transparent = is_value_transparent;
        }
        if let Some(value) = three_lighting_static_object_property_value(parameters, "visible") {
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
            && matches!(expression, Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node));
        material.is_visible =
            material.is_visible && !(is_transparent && opacity.is_some_and(|value| value <= 0.0));
        return Some(material);
    };
    for node in ctx.nodes().iter() {
        if !material.is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                let receiver_key =
                    call_expression
                        .callee
                        .as_member_expression()
                        .and_then(|member_expression| {
                            three_lighting_expression_key(
                                member_expression.object(),
                                ctx,
                                &mut Vec::new(),
                            )
                        });
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
                if receiver_key != material_emissive_key
                    && receiver_key.as_deref() == Some(material_key.as_str())
                    && call_expression
                        .callee
                        .as_member_expression()
                        .and_then(three_lighting_static_member_property_name)
                        != Some("dispose")
                {
                    material.is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(target) = assignment.left.as_member_expression().or_else(|| {
                    assignment
                        .left
                        .get_expression()?
                        .get_inner_expression()
                        .as_member_expression()
                }) else {
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
                match three_lighting_static_member_property_name(target) {
                    Some("envMap") => {
                        material.has_environment_map =
                            !three_lighting_is_nullish_expression(&assignment.right)
                    }
                    Some("metalness") => {
                        material.metalness = three_lighting_static_number(&assignment.right, ctx)
                    }
                    Some("opacity") => {
                        opacity = three_lighting_static_number(&assignment.right, ctx)
                    }
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
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<(f64, bool)> {
    let constructor =
        resolve_three_lighting_constructor(expression, static_property_write_analysis, ctx)?;
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
        if let Some(value) = three_lighting_static_number(argument, ctx) {
            intensity = value;
        } else {
            is_complete = false;
        }
    }
    let Some(light_key) = three_lighting_expression_key(expression, ctx, &mut Vec::new()) else {
        return Some((
            intensity,
            is_complete
                && matches!(three_lighting_strip_parentheses(expression), Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node)),
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
                let reassigns_light = match &assignment.left {
                    oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                        three_lighting_identifier_key(identifier, ctx, &mut Vec::new()).as_deref()
                            == Some(light_key.as_str())
                    }
                    _ => assignment
                        .left
                        .get_expression()
                        .map(Expression::get_inner_expression)
                        .is_some_and(|target| {
                            three_lighting_expression_key(target, ctx, &mut Vec::new()).as_deref()
                                == Some(light_key.as_str())
                                && matches!(target, Expression::Identifier(_))
                        }),
                };
                if reassigns_light {
                    is_complete = false;
                    continue;
                }
                let Some(target) = assignment.left.as_member_expression().or_else(|| {
                    assignment
                        .left
                        .get_expression()?
                        .get_inner_expression()
                        .as_member_expression()
                }) else {
                    continue;
                };
                if three_lighting_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(light_key.as_str())
                    || three_lighting_static_member_property_name(target) != Some("intensity")
                {
                    continue;
                }
                if !node_dominates_node(node, render_node, ctx) {
                    is_complete = false;
                } else if let Some(value) = three_lighting_static_number(&assignment.right, ctx) {
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
    match three_lighting_strip_parentheses(expression) {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

fn three_lighting_static_object_property_value<'a, 'b>(
    expression: &'b Expression<'a>,
    expected_property_name: &str,
) -> Option<&'b Expression<'a>> {
    let Expression::ObjectExpression(object_expression) =
        three_lighting_strip_parentheses(expression)
    else {
        return None;
    };
    let mut property_value = None;
    for property in &object_expression.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            property_value = None;
            continue;
        };
        let Some(property_name) = three_lighting_object_property_name(property) else {
            property_value = None;
            continue;
        };
        if property_name != expected_property_name {
            continue;
        }
        property_value =
            (property.kind == oxc_ast::ast::PropertyKind::Init).then_some(&property.value);
    }
    property_value
}

fn three_lighting_object_property_name<'a, 'b>(
    property: &'b oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'b str> {
    if property.computed {
        return match &property.key {
            oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            oxc_ast::ast::PropertyKey::TemplateLiteral(template)
                if template.expressions.is_empty() =>
            {
                template.quasis.first().map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                })
            }
            _ => None,
        };
    }
    match &property.key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn resolve_three_lighting_constructor<'a, 'b>(
    expression: &'b Expression<'a>,
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeLightingConstructor<'a, 'b>> {
    resolve_three_lighting_constructor_inner(
        expression,
        static_property_write_analysis,
        ctx,
        &mut Vec::new(),
    )
}

fn resolve_three_lighting_constructor_inner<'a, 'b>(
    expression: &'b Expression<'a>,
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<ThreeLightingConstructor<'a, 'b>> {
    let expression = three_lighting_strip_parentheses(expression);
    if let Expression::NewExpression(new_expression) = expression {
        return Some(ThreeLightingConstructor {
            constructor_name: three_lighting_api_name(
                &new_expression.callee,
                static_property_write_analysis,
                ctx,
            )?,
            node: new_expression,
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    resolve_three_lighting_constructor_inner(
        declarator.init.as_ref()?,
        static_property_write_analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_lighting_api_name<'a>(
    expression: &Expression<'a>,
    static_property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = three_lighting_api_candidate_name(expression, ctx, &mut Vec::new())?;
    if !three_lighting_api_reference_has_canonical_wrapper_shape(expression, ctx, &mut Vec::new()) {
        return None;
    }
    (module_api_reference_matches(
        expression,
        &api_name,
        &THREE_LIGHTING_MODULES,
        static_property_write_analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        expression,
        &api_name,
        &THREE_LIGHTING_MODULES,
        static_property_write_analysis,
        ctx,
    ))
    .then_some(api_name)
}

fn three_lighting_api_reference_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_lighting_strip_parentheses(expression);
    if let Some(member_expression) = expression.as_member_expression() {
        return three_lighting_module_namespace_has_canonical_wrapper_shape(
            member_expression.object(),
            ctx,
            visited_symbol_ids,
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::TSImportEqualsDeclaration(_)) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return true;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            three_lighting_api_reference_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    destructured_binding_provenance(&declarator.id, symbol_id, declarator.init.as_ref())
        .is_some_and(|(_, initializer)| {
            three_lighting_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_lighting_module_namespace_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_lighting_strip_parentheses(expression);
    if matches!(expression, Expression::CallExpression(_)) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::TSImportEqualsDeclaration(_)) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return true;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            three_lighting_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_lighting_api_candidate_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = three_lighting_strip_parentheses(expression);
    if let Some(member_expression) = expression.as_member_expression() {
        return three_lighting_static_member_property_name(member_expression).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_lighting_api_candidate_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}

fn three_lighting_static_member_property_name<'a, 'b>(
    member_expression: &'b oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'b str> {
    match member_expression {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            match &member.expression {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                    template.quasis.first().map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    })
                }
                _ => None,
            }
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn three_lighting_is_nullish_expression(expression: &Expression<'_>) -> bool {
    match three_lighting_strip_parentheses(expression) {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::UnaryExpression(unary_expression) => {
            unary_expression.operator == UnaryOperator::Void
        }
        _ => false,
    }
}

fn three_lighting_static_number<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    three_lighting_static_number_inner(expression, ctx, &mut Vec::new())
}

fn three_lighting_static_number_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<f64> {
    let expression = three_lighting_strip_parentheses(expression);
    let value = match expression {
        Expression::NumericLiteral(number) => number.value,
        Expression::UnaryExpression(unary_expression)
            if matches!(
                unary_expression.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) =>
        {
            let operand = three_lighting_static_number_inner(
                &unary_expression.argument,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            if unary_expression.operator == UnaryOperator::UnaryNegation {
                -operand
            } else {
                operand
            }
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| !reference.is_read() || reference.is_write())
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            let initializer = binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                declarator.init.as_ref(),
            )?;
            three_lighting_static_number_inner(initializer, ctx, visited_symbol_ids)?
        }
        Expression::BinaryExpression(binary_expression) => {
            let left = three_lighting_static_number_inner(
                &binary_expression.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            let right = three_lighting_static_number_inner(
                &binary_expression.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            match binary_expression.operator {
                BinaryOperator::Addition => left + right,
                BinaryOperator::Subtraction => left - right,
                BinaryOperator::Multiplication => left * right,
                BinaryOperator::Division => left / right,
                BinaryOperator::Exponential => left.powf(right),
                _ => return None,
            }
        }
        _ => return None,
    };
    value.is_finite().then_some(value)
}

fn three_lighting_expression_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = three_lighting_strip_parentheses(expression);
    if let Expression::Identifier(identifier) = expression {
        return three_lighting_identifier_key(identifier, ctx, visited_symbol_ids);
    }
    if let Some(member_expression) = expression.as_member_expression() {
        let property_name = three_lighting_static_member_property_name(member_expression)?;
        if property_name.is_empty() {
            return None;
        }
        let object_key =
            three_lighting_expression_key(member_expression.object(), ctx, visited_symbol_ids)?;
        return Some(format!("{object_key}.{property_name}"));
    }
    match expression {
        Expression::ThisExpression(_) => Some("this".to_string()),
        Expression::StringLiteral(literal) => Some(format!("literal:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!(
            "literal:{}",
            format_javascript_number(literal.value)
        )),
        Expression::ArrowFunctionExpression(function) => {
            Some(format!("function:{}", function.span.start))
        }
        Expression::FunctionExpression(function) => {
            Some(format!("function:{}", function.span.start))
        }
        _ => None,
    }
}

fn three_lighting_identifier_key(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return Some(format!("global:{}", identifier.name));
    };
    let symbol_key = format!("symbol:{}", symbol_id.index());
    if visited_symbol_ids.contains(&symbol_id) {
        return Some(symbol_key);
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_key);
    };
    if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
        && let Some(property_name) = pattern.properties.iter().find_map(|property| {
            matches!(
                &property.value,
                oxc_ast::ast::BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id
            )
            .then(|| {
                three_lighting_property_key_name(&property.key, property.computed)
                    .map(str::to_string)
            })
            .flatten()
            .filter(|property_name| !property_name.is_empty())
        })
    {
        return declarator
            .init
            .as_ref()
            .and_then(|initializer| {
                three_lighting_expression_key(initializer, ctx, visited_symbol_ids)
            })
            .map_or(Some(symbol_key), |object_key| {
                Some(format!("{object_key}.{property_name}"))
            });
    }
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return Some(symbol_key);
    }
    let Some(initializer) =
        binding_pattern_initializer_for_symbol(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return Some(symbol_key);
    };
    let initializer = three_lighting_strip_parentheses(initializer);
    if matches!(initializer, Expression::Identifier(_))
        || initializer.as_member_expression().is_some()
    {
        return three_lighting_expression_key(initializer, ctx, visited_symbol_ids)
            .or(Some(symbol_key));
    }
    Some(symbol_key)
}

fn three_lighting_property_key_name<'a, 'b>(
    key: &'b oxc_ast::ast::PropertyKey<'a>,
    is_computed: bool,
) -> Option<&'b str> {
    if is_computed {
        return None;
    }
    match key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn three_lighting_strip_parentheses<'a, 'b>(
    mut expression: &'b Expression<'a>,
) -> &'b Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}
