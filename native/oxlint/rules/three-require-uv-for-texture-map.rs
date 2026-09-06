use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentExpression, Expression, MemberExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_UV_ATTRIBUTE_NAMES: [&str; 4] = ["uv", "uv1", "uv2", "uv3"];
const THREE_UV_GEOMETRY_PRESERVING_METHOD_NAMES: [&str; 15] = [
    "addGroup",
    "center",
    "clearGroups",
    "computeBoundingBox",
    "computeBoundingSphere",
    "computeTangents",
    "lookAt",
    "normalizeNormals",
    "rotateX",
    "rotateY",
    "rotateZ",
    "scale",
    "setDrawRange",
    "setIndex",
    "translate",
];
const THREE_UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL: [(&str, &[&str]); 10] = [
    (
        "MeshBasicMaterial",
        &["alphaMap", "aoMap", "lightMap", "map", "specularMap"],
    ),
    ("MeshDepthMaterial", &["alphaMap", "displacementMap", "map"]),
    (
        "MeshDistanceMaterial",
        &["alphaMap", "displacementMap", "map"],
    ),
    (
        "MeshLambertMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "normalMap",
            "specularMap",
        ],
    ),
    (
        "MeshMatcapMaterial",
        &["alphaMap", "bumpMap", "displacementMap", "map", "normalMap"],
    ),
    (
        "MeshNormalMaterial",
        &["bumpMap", "displacementMap", "normalMap"],
    ),
    (
        "MeshPhongMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "normalMap",
            "specularMap",
        ],
    ),
    (
        "MeshPhysicalMaterial",
        &[
            "alphaMap",
            "anisotropyMap",
            "aoMap",
            "bumpMap",
            "clearcoatMap",
            "clearcoatNormalMap",
            "clearcoatRoughnessMap",
            "displacementMap",
            "emissiveMap",
            "iridescenceMap",
            "iridescenceThicknessMap",
            "lightMap",
            "map",
            "metalnessMap",
            "normalMap",
            "roughnessMap",
            "sheenColorMap",
            "sheenRoughnessMap",
            "specularColorMap",
            "specularIntensityMap",
            "thicknessMap",
            "transmissionMap",
        ],
    ),
    (
        "MeshStandardMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "metalnessMap",
            "normalMap",
            "roughnessMap",
        ],
    ),
    (
        "MeshToonMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "normalMap",
        ],
    ),
];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireUvForTextureMap;

impl RuleMeta for ThreeRequireUvForTextureMap {
    const NAME: &'static str = "three-require-uv-for-texture-map";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require UV attributes for texture-mapped Three.js meshes.",
    };
}

struct ThreeUvResolvedConstructor<'a, 'node> {
    constructor_name: &'static str,
    node: &'node oxc_ast::ast::NewExpression<'a>,
}

struct ThreeUvGeometryAttributes {
    attribute_names: rustc_hash::FxHashSet<String>,
    is_complete: bool,
}

struct ThreeUvMaterialTextureProperties {
    property_names: Vec<String>,
    is_complete: bool,
    is_visible: bool,
}

impl Rule for ThreeRequireUvForTextureMap {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mesh_candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                (three_uv_candidate_api_name(&allocation.callee, ctx, &mut Vec::new()).as_deref()
                    == Some("Mesh"))
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if mesh_candidate_ids.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);

        for mesh_candidate_id in mesh_candidate_ids {
            let mesh_node = ctx.nodes().get_node(mesh_candidate_id);
            let AstKind::NewExpression(mesh) = mesh_node.kind() else {
                continue;
            };
            if !three_uv_constructor_callee_matches(&mesh.callee, "Mesh", &analysis, ctx) {
                continue;
            }
            let Some(geometry) = mesh.arguments.first().and_then(Argument::as_expression) else {
                continue;
            };
            let Some(material) = mesh.arguments.get(1).and_then(Argument::as_expression) else {
                continue;
            };
            let Some(material_constructor) =
                three_uv_resolve_constructor(material, &analysis, ctx, &mut Vec::new())
            else {
                continue;
            };
            if three_uv_texture_properties_for_material(material_constructor.constructor_name)
                .is_none()
            {
                continue;
            }
            let Some(attributes) =
                three_uv_static_geometry_attributes(geometry, mesh_node, &analysis, ctx)
            else {
                continue;
            };
            let Some(texture_properties) =
                three_uv_static_material_texture_properties(material, mesh_node, &analysis, ctx)
            else {
                continue;
            };
            if !attributes.is_complete
                || !texture_properties.is_complete
                || !texture_properties.is_visible
                || three_uv_static_mesh_visibility(mesh_node, &analysis, ctx) != Some(true)
                || !attributes.attribute_names.contains("position")
                || texture_properties.property_names.is_empty()
                || THREE_UV_ATTRIBUTE_NAMES
                    .iter()
                    .any(|attribute_name| attributes.attribute_names.contains(*attribute_name))
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "{} samples {}, but this custom BufferGeometry defines positions without any UV attribute",
                    material_constructor.constructor_name,
                    texture_properties.property_names.join(", ")
                ))
                .with_label(geometry.span()),
            );
        }
    }
}

fn three_uv_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return static_member_expression_property_name(member).map(str::to_string);
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
            return three_uv_candidate_api_name(declarator.init.as_ref()?, ctx, visited_symbol_ids);
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

fn three_uv_resolve_constructor<'a, 'node>(
    expression: &'node Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<ThreeUvResolvedConstructor<'a, 'node>> {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        let constructor_name = ["Mesh", "BufferGeometry", "Scene"]
            .into_iter()
            .chain(
                THREE_UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL
                    .iter()
                    .map(|(constructor_name, _)| *constructor_name),
            )
            .find(|constructor_name| {
                module_api_reference_matches(
                    &allocation.callee,
                    constructor_name,
                    &THREE_MODULES,
                    analysis,
                    ctx,
                ) || type_import_module_api_reference_matches(
                    &allocation.callee,
                    constructor_name,
                    &THREE_MODULES,
                    analysis,
                    ctx,
                )
            })?;
        return Some(ThreeUvResolvedConstructor {
            constructor_name,
            node: allocation,
        });
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
    three_uv_resolve_constructor(declarator.init.as_ref()?, analysis, ctx, visited_symbol_ids)
}

fn three_uv_static_geometry_attributes<'a>(
    expression: &Expression<'a>,
    before_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeUvGeometryAttributes> {
    let constructor = three_uv_resolve_constructor(expression, analysis, ctx, &mut Vec::new())?;
    if constructor.constructor_name != "BufferGeometry" {
        return None;
    }
    let Some(geometry_key) = resolve_expression_key(expression, ctx, &mut Vec::new()) else {
        return Some(ThreeUvGeometryAttributes {
            attribute_names: rustc_hash::FxHashSet::default(),
            is_complete: matches!(expression.get_inner_expression(), Expression::NewExpression(candidate)
                if std::ptr::eq(candidate.as_ref(), constructor.node)),
        });
    };
    let mut attributes = ThreeUvGeometryAttributes {
        attribute_names: rustc_hash::FxHashSet::default(),
        is_complete: true,
    };
    for node in ctx.nodes().iter() {
        if !attributes.is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                let receiver_key = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(|callee| {
                        resolve_expression_key(callee.object(), ctx, &mut Vec::new())
                    });
                let touches_geometry = receiver_key.as_deref() == Some(geometry_key.as_str())
                    || call_expression.arguments.iter().any(|argument| {
                        argument.as_expression().is_some_and(|argument| {
                            resolve_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                                == Some(geometry_key.as_str())
                        })
                    });
                if touches_geometry && !node_dominates_node(node, before_node, ctx) {
                    attributes.is_complete = false;
                    continue;
                }
                if call_expression.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        resolve_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                            == Some(geometry_key.as_str())
                    })
                }) {
                    attributes.is_complete = false;
                    continue;
                }
                if receiver_key.as_deref() != Some(geometry_key.as_str()) {
                    continue;
                }
                let method_name = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(static_member_expression_property_name);
                if method_name == Some("computeVertexNormals") {
                    attributes.attribute_names.insert("normal".to_string());
                } else if matches!(method_name, Some("setAttribute" | "addAttribute")) {
                    let Some(attribute_name) = call_expression
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(get_static_string_expression)
                    else {
                        attributes.is_complete = false;
                        continue;
                    };
                    attributes
                        .attribute_names
                        .insert(attribute_name.to_string());
                } else if method_name.is_none_or(|method_name| {
                    !THREE_UV_GEOMETRY_PRESERVING_METHOD_NAMES.contains(&method_name)
                }) {
                    attributes.is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                if three_uv_assignment_identifier_key(assignment, ctx).as_deref()
                    == Some(geometry_key.as_str())
                {
                    attributes.is_complete = false;
                    continue;
                }
                let Some(target) = three_uv_assignment_member_target(assignment) else {
                    continue;
                };
                if static_member_expression_property_name(target) == Some("attributes")
                    && resolve_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                        == Some(geometry_key.as_str())
                {
                    attributes.is_complete = false;
                    continue;
                }
                let Some(attributes_member) = target
                    .object()
                    .get_inner_expression()
                    .as_member_expression()
                else {
                    continue;
                };
                if static_member_expression_property_name(attributes_member) == Some("attributes")
                    && resolve_expression_key(attributes_member.object(), ctx, &mut Vec::new())
                        .as_deref()
                        == Some(geometry_key.as_str())
                {
                    attributes.is_complete = false;
                }
            }
            _ => {}
        }
    }
    Some(attributes)
}

fn three_uv_static_material_texture_properties<'a>(
    expression: &Expression<'a>,
    before_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeUvMaterialTextureProperties> {
    let constructor = three_uv_resolve_constructor(expression, analysis, ctx, &mut Vec::new())?;
    let texture_property_names =
        three_uv_texture_properties_for_material(constructor.constructor_name)?;
    let mut result = ThreeUvMaterialTextureProperties {
        property_names: Vec::new(),
        is_complete: true,
        is_visible: true,
    };
    let mut is_transparent = false;
    let mut opacity = None;
    if let Some(parameters_argument) = constructor.node.arguments.first() {
        let Some(parameters) = parameters_argument.as_expression() else {
            result.is_complete = false;
            return Some(result);
        };
        let Expression::ObjectExpression(object) = parameters.get_inner_expression() else {
            result.is_complete = false;
            return Some(result);
        };
        if object
            .properties
            .iter()
            .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
        {
            result.is_complete = false;
            return Some(result);
        }
        for &property_name in texture_property_names {
            if get_static_object_property_value(parameters, property_name)
                .is_some_and(|value| !is_nullish_expression(value))
            {
                result.property_names.push(property_name.to_string());
            }
        }
        if let Some(value) = get_static_object_property_value(parameters, "visible") {
            let Some(is_visible) = three_uv_static_boolean(value) else {
                result.is_complete = false;
                return Some(result);
            };
            result.is_visible = is_visible;
        }
        if let Some(value) = get_static_object_property_value(parameters, "transparent") {
            let Some(transparent) = three_uv_static_boolean(value) else {
                result.is_complete = false;
                return Some(result);
            };
            is_transparent = transparent;
        }
        if let Some(value) = get_static_object_property_value(parameters, "opacity") {
            opacity = resolve_static_number(value, ctx);
            if opacity.is_none() && !is_nullish_expression(value) {
                result.is_complete = false;
                return Some(result);
            }
        }
    }
    let Some(material_key) = resolve_expression_key(expression, ctx, &mut Vec::new()) else {
        result.is_complete = result.is_complete
            && matches!(expression.get_inner_expression(), Expression::NewExpression(candidate)
                if std::ptr::eq(candidate.as_ref(), constructor.node));
        result.is_visible =
            result.is_visible && !(is_transparent && opacity.is_some_and(|value| value <= 0.0));
        return Some(result);
    };
    for node in ctx.nodes().iter() {
        if !result.is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                let receiver_key = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(|callee| {
                        resolve_expression_key(callee.object(), ctx, &mut Vec::new())
                    });
                let has_material_argument = call_expression.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        resolve_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                            == Some(material_key.as_str())
                    })
                });
                let touches_material =
                    receiver_key.as_deref() == Some(material_key.as_str()) || has_material_argument;
                if touches_material && !node_dominates_node(node, before_node, ctx) {
                    result.is_complete = false;
                } else if has_material_argument {
                    result.is_complete = false;
                } else if receiver_key.as_deref() == Some(material_key.as_str())
                    && call_expression
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                        .and_then(static_member_expression_property_name)
                        != Some("dispose")
                {
                    result.is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(target) = three_uv_assignment_member_target(assignment) else {
                    continue;
                };
                if resolve_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(material_key.as_str())
                {
                    continue;
                }
                if !node_dominates_node(node, before_node, ctx) {
                    result.is_complete = false;
                    continue;
                }
                let property_name = static_member_expression_property_name(target);
                match property_name {
                    Some("visible") => {
                        let Some(value) = three_uv_static_boolean(&assignment.right) else {
                            result.is_complete = false;
                            continue;
                        };
                        result.is_visible = value;
                    }
                    Some("transparent") => {
                        let Some(value) = three_uv_static_boolean(&assignment.right) else {
                            result.is_complete = false;
                            continue;
                        };
                        is_transparent = value;
                    }
                    Some("opacity") => {
                        opacity = resolve_static_number(&assignment.right, ctx);
                        if opacity.is_none() && !is_nullish_expression(&assignment.right) {
                            result.is_complete = false;
                        }
                    }
                    Some(property_name) if texture_property_names.contains(&property_name) => {
                        if is_nullish_expression(&assignment.right) {
                            result
                                .property_names
                                .retain(|candidate| candidate != property_name);
                        } else if !result
                            .property_names
                            .iter()
                            .any(|candidate| candidate == property_name)
                        {
                            result.property_names.push(property_name.to_string());
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    result.is_visible =
        result.is_visible && !(is_transparent && opacity.is_some_and(|value| value <= 0.0));
    Some(result)
}

fn three_uv_static_mesh_visibility<'a>(
    mesh_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let AstKind::NewExpression(mesh) = mesh_node.kind() else {
        return None;
    };
    if !three_uv_constructor_callee_matches(&mesh.callee, "Mesh", analysis, ctx) {
        return None;
    }
    let mesh_root = transparent_expression_root(mesh_node, ctx);
    let declaration = ctx.nodes().parent_node(mesh_root.id());
    let mesh_key = if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == mesh_root.span())
        && let Some(binding) = declarator.id.get_binding_identifier()
    {
        Some(format!("symbol:{}", binding.symbol_id().index()))
    } else {
        None
    };
    let Some(mesh_key) = mesh_key else {
        let parent = ctx.nodes().parent_node(mesh_root.id());
        if matches!(parent.kind(), AstKind::ExpressionStatement(_)) {
            return Some(true);
        }
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            return None;
        };
        let callee = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()?;
        return (static_member_expression_property_name(callee) == Some("add")
            && three_uv_resolve_constructor(callee.object(), analysis, ctx, &mut Vec::new())
                .is_some_and(|constructor| constructor.constructor_name == "Scene"))
        .then_some(true);
    };
    let mesh_owner_id =
        crate::ast_util::get_enclosing_function(mesh_node, ctx).map(crate::AstNode::id);
    let mut is_visible = true;
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                let receiver_key = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(|callee| {
                        resolve_expression_key(callee.object(), ctx, &mut Vec::new())
                    });
                let passes_mesh = call_expression.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        resolve_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                            == Some(mesh_key.as_str())
                    })
                });
                if receiver_key.as_deref() == Some(mesh_key.as_str()) {
                    return None;
                }
                if !passes_mesh {
                    continue;
                }
                let Some(callee) = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                else {
                    return None;
                };
                if static_member_expression_property_name(callee) != Some("add")
                    || three_uv_resolve_constructor(callee.object(), analysis, ctx, &mut Vec::new())
                        .is_none_or(|constructor| constructor.constructor_name != "Scene")
                {
                    return None;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                if three_uv_assignment_identifier_key(assignment, ctx).as_deref()
                    == Some(mesh_key.as_str())
                {
                    return None;
                }
                let Some(target) = three_uv_assignment_member_target(assignment) else {
                    continue;
                };
                if resolve_expression_key(target.object(), ctx, &mut Vec::new()).as_deref()
                    != Some(mesh_key.as_str())
                    || static_member_expression_property_name(target) != Some("visible")
                {
                    continue;
                }
                if crate::ast_util::get_enclosing_function(node, ctx).map(crate::AstNode::id)
                    != mesh_owner_id
                    || is_node_conditionally_executed(
                        node,
                        mesh_owner_id.unwrap_or_else(|| {
                            ctx.nodes()
                                .iter()
                                .find(|candidate| matches!(candidate.kind(), AstKind::Program(_)))
                                .expect("program")
                                .id()
                        }),
                        ctx,
                    )
                    || node_is_inside_repeated_execution(node, ctx)
                {
                    return None;
                }
                let Some(visible) = three_uv_static_boolean(&assignment.right) else {
                    return None;
                };
                is_visible = visible;
            }
            _ => {}
        }
    }
    Some(is_visible)
}

fn three_uv_assignment_member_target<'a, 'node>(
    assignment: &'node AssignmentExpression<'a>,
) -> Option<&'node MemberExpression<'a>> {
    assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })
}

fn three_uv_assignment_identifier_key(
    assignment: &AssignmentExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map_or_else(
                || Some(format!("global:{}", identifier.name)),
                |symbol_id| Some(format!("symbol:{}", symbol_id.index())),
            );
    }
    let expression = assignment.left.get_expression()?.get_inner_expression();
    matches!(expression, Expression::Identifier(_))
        .then(|| resolve_expression_key(expression, ctx, &mut Vec::new()))
        .flatten()
}

fn three_uv_constructor_callee_matches<'a>(
    callee: &Expression<'a>,
    constructor_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(callee, constructor_name, &THREE_MODULES, analysis, ctx)
        || type_import_module_api_reference_matches(
            callee,
            constructor_name,
            &THREE_MODULES,
            analysis,
            ctx,
        )
}

fn three_uv_texture_properties_for_material(
    constructor_name: &str,
) -> Option<&'static [&'static str]> {
    THREE_UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL
        .iter()
        .find_map(|(candidate, property_names)| {
            (*candidate == constructor_name).then_some(*property_names)
        })
}

fn three_uv_static_boolean(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}
