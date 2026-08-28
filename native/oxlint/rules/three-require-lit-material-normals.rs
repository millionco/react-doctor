use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentExpression, Expression, MemberExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, UnaryOperator};

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const LIT_MATERIAL_NAMES: [&str; 5] = [
    "MeshLambertMaterial",
    "MeshPhongMaterial",
    "MeshPhysicalMaterial",
    "MeshStandardMaterial",
    "MeshToonMaterial",
];
const GEOMETRY_PRESERVING_METHOD_NAMES: [&str; 15] = [
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

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireLitMaterialNormals;

struct ThreeLitNormalsResolvedConstructor<'a, 'node> {
    constructor_name: &'static str,
    node: &'node oxc_ast::ast::NewExpression<'a>,
}

struct ThreeLitNormalsGeometryAttributes {
    attribute_names: rustc_hash::FxHashSet<String>,
    is_complete: bool,
}

struct ThreeLitNormalsMaterialProperties {
    has_normal_map: bool,
    is_complete: bool,
    is_visible: bool,
}

impl RuleMeta for ThreeRequireLitMaterialNormals {
    const NAME: &'static str = "three-require-lit-material-normals";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require normals for normal-mapped Three.js geometry.",
    };
}

impl Rule for ThreeRequireLitMaterialNormals {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mesh_candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                (three_lit_normals_candidate_api_name(&allocation.callee, ctx, &mut Vec::new())
                    .as_deref()
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
            if !three_lit_normals_constructor_callee_matches(&mesh.callee, "Mesh", &analysis, ctx) {
                continue;
            }
            let Some(geometry) = mesh.arguments.first().and_then(Argument::as_expression) else {
                continue;
            };
            let Some(material) = mesh.arguments.get(1).and_then(Argument::as_expression) else {
                continue;
            };
            let Some(material_constructor) =
                three_lit_normals_resolve_constructor(material, &analysis, ctx, &mut Vec::new())
            else {
                continue;
            };
            if !LIT_MATERIAL_NAMES.contains(&material_constructor.constructor_name) {
                continue;
            }
            let Some(attributes) =
                three_lit_normals_static_geometry_attributes(geometry, mesh_node, &analysis, ctx)
            else {
                continue;
            };
            let Some(material_properties) = three_lit_normals_static_material_properties(
                material,
                mesh_node,
                &material_constructor,
                ctx,
            ) else {
                continue;
            };
            if !attributes.is_complete
                || !material_properties.is_complete
                || !material_properties.is_visible
                || three_lit_normals_static_mesh_visibility(mesh_node, &analysis, ctx) != Some(true)
                || !attributes.attribute_names.contains("position")
                || attributes.attribute_names.contains("normal")
                || !material_properties.has_normal_map
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "{} applies a normalMap to this custom BufferGeometry, but the geometry defines positions without the normals needed to establish its normal basis",
                    material_constructor.constructor_name
                ))
                .with_label(geometry.span()),
            );
        }
    }
}

fn three_lit_normals_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = three_lit_normals_strip_parentheses(expression);
    if let Some(member) = expression.as_member_expression() {
        return three_lit_normals_static_member_property_name(member).map(str::to_string);
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
            return three_lit_normals_candidate_api_name(
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

fn three_lit_normals_resolve_constructor<'a, 'node>(
    expression: &'node Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<ThreeLitNormalsResolvedConstructor<'a, 'node>> {
    let expression = three_lit_normals_strip_parentheses(expression);
    if let Expression::NewExpression(allocation) = expression {
        let constructor_name = ["Mesh", "BufferGeometry", "Scene"]
            .into_iter()
            .chain(LIT_MATERIAL_NAMES)
            .find(|constructor_name| {
                three_lit_normals_constructor_callee_matches(
                    &allocation.callee,
                    constructor_name,
                    analysis,
                    ctx,
                )
            })?;
        return Some(ThreeLitNormalsResolvedConstructor {
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
    three_lit_normals_resolve_constructor(
        declarator.init.as_ref()?,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn three_lit_normals_static_geometry_attributes<'a>(
    expression: &Expression<'a>,
    before_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<ThreeLitNormalsGeometryAttributes> {
    let constructor =
        three_lit_normals_resolve_constructor(expression, analysis, ctx, &mut Vec::new())?;
    if constructor.constructor_name != "BufferGeometry" {
        return None;
    }
    let Some(geometry_key) = three_lit_normals_expression_key(expression, ctx, &mut Vec::new())
    else {
        return Some(ThreeLitNormalsGeometryAttributes {
            attribute_names: rustc_hash::FxHashSet::default(),
            is_complete: matches!(
                expression,
                Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node)
            ),
        });
    };
    let mut result = ThreeLitNormalsGeometryAttributes {
        attribute_names: rustc_hash::FxHashSet::default(),
        is_complete: true,
    };
    for node in ctx.nodes().iter() {
        if !result.is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call) => {
                let receiver_key = call.callee.as_member_expression().and_then(|callee| {
                    three_lit_normals_expression_key(callee.object(), ctx, &mut Vec::new())
                });
                let has_geometry_argument = call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        three_lit_normals_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                            == Some(geometry_key.as_str())
                    })
                });
                if (receiver_key.as_deref() == Some(geometry_key.as_str()) || has_geometry_argument)
                    && !node_dominates_node(node, before_node, ctx)
                {
                    result.is_complete = false;
                    continue;
                }
                if has_geometry_argument {
                    result.is_complete = false;
                    continue;
                }
                if receiver_key.as_deref() != Some(geometry_key.as_str()) {
                    continue;
                }
                let method_name = call
                    .callee
                    .as_member_expression()
                    .and_then(three_lit_normals_static_member_property_name);
                if method_name == Some("computeVertexNormals") {
                    result.attribute_names.insert("normal".to_string());
                } else if matches!(method_name, Some("setAttribute" | "addAttribute")) {
                    let Some(attribute_name) = call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(three_lit_normals_static_string)
                    else {
                        result.is_complete = false;
                        continue;
                    };
                    result.attribute_names.insert(attribute_name.to_string());
                } else if method_name.is_none_or(|method_name| {
                    !GEOMETRY_PRESERVING_METHOD_NAMES.contains(&method_name)
                }) {
                    result.is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                if three_lit_normals_assignment_identifier_key(assignment, ctx).as_deref()
                    == Some(geometry_key.as_str())
                {
                    result.is_complete = false;
                    continue;
                }
                let Some(target) = three_lit_normals_assignment_member_target(assignment) else {
                    continue;
                };
                if three_lit_normals_static_member_property_name(target) == Some("attributes")
                    && three_lit_normals_expression_key(target.object(), ctx, &mut Vec::new())
                        .as_deref()
                        == Some(geometry_key.as_str())
                {
                    result.is_complete = false;
                    continue;
                }
                let Some(attributes) =
                    three_lit_normals_strip_parentheses(target.object()).as_member_expression()
                else {
                    continue;
                };
                if three_lit_normals_static_member_property_name(attributes) == Some("attributes")
                    && three_lit_normals_expression_key(attributes.object(), ctx, &mut Vec::new())
                        .as_deref()
                        == Some(geometry_key.as_str())
                {
                    result.is_complete = false;
                }
            }
            _ => {}
        }
    }
    Some(result)
}

fn three_lit_normals_static_material_properties<'a, 'node>(
    expression: &Expression<'a>,
    before_node: &crate::AstNode<'a>,
    constructor: &ThreeLitNormalsResolvedConstructor<'a, 'node>,
    ctx: &LintContext<'a>,
) -> Option<ThreeLitNormalsMaterialProperties> {
    if !LIT_MATERIAL_NAMES.contains(&constructor.constructor_name) {
        return None;
    }
    let mut result = ThreeLitNormalsMaterialProperties {
        has_normal_map: false,
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
        let Expression::ObjectExpression(object) = three_lit_normals_strip_parentheses(parameters)
        else {
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
        result.has_normal_map =
            three_lit_normals_static_object_property_value(parameters, "normalMap")
                .is_some_and(|value| !three_lit_normals_is_nullish(value));
        if let Some(value) = three_lit_normals_static_object_property_value(parameters, "visible") {
            let Some(visible) = three_lit_normals_static_boolean(value) else {
                result.is_complete = false;
                return Some(result);
            };
            result.is_visible = visible;
        }
        if let Some(value) =
            three_lit_normals_static_object_property_value(parameters, "transparent")
        {
            let Some(transparent) = three_lit_normals_static_boolean(value) else {
                result.is_complete = false;
                return Some(result);
            };
            is_transparent = transparent;
        }
        if let Some(value) = three_lit_normals_static_object_property_value(parameters, "opacity") {
            opacity = three_lit_normals_static_number(value, ctx);
            if opacity.is_none() && !three_lit_normals_is_nullish(value) {
                result.is_complete = false;
                return Some(result);
            }
        }
    }
    let Some(material_key) = three_lit_normals_expression_key(expression, ctx, &mut Vec::new())
    else {
        result.is_complete = result.is_complete
            && matches!(
                expression,
                Expression::NewExpression(candidate) if std::ptr::eq(candidate.as_ref(), constructor.node)
            );
        result.is_visible =
            result.is_visible && !(is_transparent && opacity.is_some_and(|value| value <= 0.0));
        return Some(result);
    };
    for node in ctx.nodes().iter() {
        if !result.is_complete {
            break;
        }
        match node.kind() {
            AstKind::CallExpression(call) => {
                let receiver_key = call.callee.as_member_expression().and_then(|callee| {
                    three_lit_normals_expression_key(callee.object(), ctx, &mut Vec::new())
                });
                let has_material_argument = call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        three_lit_normals_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                            == Some(material_key.as_str())
                    })
                });
                if (receiver_key.as_deref() == Some(material_key.as_str()) || has_material_argument)
                    && !node_dominates_node(node, before_node, ctx)
                {
                    result.is_complete = false;
                } else if has_material_argument {
                    result.is_complete = false;
                } else if receiver_key.as_deref() == Some(material_key.as_str())
                    && call
                        .callee
                        .as_member_expression()
                        .and_then(three_lit_normals_static_member_property_name)
                        != Some("dispose")
                {
                    result.is_complete = false;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(target) = three_lit_normals_assignment_member_target(assignment) else {
                    continue;
                };
                if three_lit_normals_expression_key(target.object(), ctx, &mut Vec::new())
                    .as_deref()
                    != Some(material_key.as_str())
                {
                    continue;
                }
                if !node_dominates_node(node, before_node, ctx) {
                    result.is_complete = false;
                    continue;
                }
                match three_lit_normals_static_member_property_name(target) {
                    Some("visible") => {
                        let Some(visible) = three_lit_normals_static_boolean(&assignment.right)
                        else {
                            result.is_complete = false;
                            continue;
                        };
                        result.is_visible = visible;
                    }
                    Some("transparent") => {
                        let Some(transparent) = three_lit_normals_static_boolean(&assignment.right)
                        else {
                            result.is_complete = false;
                            continue;
                        };
                        is_transparent = transparent;
                    }
                    Some("opacity") => {
                        opacity = three_lit_normals_static_number(&assignment.right, ctx);
                        if opacity.is_none() && !three_lit_normals_is_nullish(&assignment.right) {
                            result.is_complete = false;
                        }
                    }
                    Some("normalMap") => {
                        result.has_normal_map = !three_lit_normals_is_nullish(&assignment.right);
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

fn three_lit_normals_static_mesh_visibility<'a>(
    mesh_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let AstKind::NewExpression(mesh) = mesh_node.kind() else {
        return None;
    };
    if !three_lit_normals_constructor_callee_matches(&mesh.callee, "Mesh", analysis, ctx) {
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
        let AstKind::CallExpression(call) = parent.kind() else {
            return None;
        };
        let callee = call.callee.as_member_expression()?;
        return (three_lit_normals_static_member_property_name(callee) == Some("add")
            && three_lit_normals_resolve_constructor(
                callee.object(),
                analysis,
                ctx,
                &mut Vec::new(),
            )
            .is_some_and(|constructor| constructor.constructor_name == "Scene"))
        .then_some(true);
    };
    let mesh_owner_id =
        crate::ast_util::get_enclosing_function(mesh_node, ctx).map(crate::AstNode::id);
    let program_id = ctx
        .nodes()
        .iter()
        .find(|node| matches!(node.kind(), AstKind::Program(_)))?
        .id();
    let mut is_visible = true;
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::CallExpression(call) => {
                let receiver_key = call.callee.as_member_expression().and_then(|callee| {
                    three_lit_normals_expression_key(callee.object(), ctx, &mut Vec::new())
                });
                let passes_mesh = call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        three_lit_normals_expression_key(argument, ctx, &mut Vec::new()).as_deref()
                            == Some(mesh_key.as_str())
                    })
                });
                if receiver_key.as_deref() == Some(mesh_key.as_str()) {
                    return None;
                }
                if !passes_mesh {
                    continue;
                }
                let Some(callee) = call.callee.as_member_expression() else {
                    return None;
                };
                if three_lit_normals_static_member_property_name(callee) != Some("add")
                    || three_lit_normals_resolve_constructor(
                        callee.object(),
                        analysis,
                        ctx,
                        &mut Vec::new(),
                    )
                    .is_none_or(|constructor| constructor.constructor_name != "Scene")
                {
                    return None;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                if three_lit_normals_assignment_identifier_key(assignment, ctx).as_deref()
                    == Some(mesh_key.as_str())
                {
                    return None;
                }
                let Some(target) = three_lit_normals_assignment_member_target(assignment) else {
                    continue;
                };
                if three_lit_normals_expression_key(target.object(), ctx, &mut Vec::new())
                    .as_deref()
                    != Some(mesh_key.as_str())
                    || three_lit_normals_static_member_property_name(target) != Some("visible")
                {
                    continue;
                }
                if crate::ast_util::get_enclosing_function(node, ctx).map(crate::AstNode::id)
                    != mesh_owner_id
                    || is_node_conditionally_executed(
                        node,
                        mesh_owner_id.unwrap_or(program_id),
                        ctx,
                    )
                    || node_is_inside_repeated_execution(node, ctx)
                {
                    return None;
                }
                let Some(visible) = three_lit_normals_static_boolean(&assignment.right) else {
                    return None;
                };
                is_visible = visible;
            }
            _ => {}
        }
    }
    Some(is_visible)
}

fn three_lit_normals_assignment_member_target<'a, 'node>(
    assignment: &'node AssignmentExpression<'a>,
) -> Option<&'node MemberExpression<'a>> {
    assignment.left.as_member_expression()
}

fn three_lit_normals_assignment_identifier_key(
    assignment: &AssignmentExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    {
        return three_lit_normals_identifier_key(identifier, ctx, &mut Vec::new());
    }
    None
}

fn three_lit_normals_constructor_callee_matches<'a>(
    callee: &Expression<'a>,
    constructor_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    three_lit_normals_api_reference_has_canonical_wrapper_shape(callee, ctx, &mut Vec::new())
        && (module_api_reference_matches(callee, constructor_name, &THREE_MODULES, analysis, ctx)
            || type_import_module_api_reference_matches(
                callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            ))
}

fn three_lit_normals_static_boolean(expression: &Expression<'_>) -> Option<bool> {
    match three_lit_normals_strip_parentheses(expression) {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

fn three_lit_normals_static_string<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match three_lit_normals_strip_parentheses(expression) {
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

fn three_lit_normals_static_object_property_value<'a, 'node>(
    expression: &'node Expression<'a>,
    expected_property_name: &str,
) -> Option<&'node Expression<'a>> {
    let Expression::ObjectExpression(object) = three_lit_normals_strip_parentheses(expression)
    else {
        return None;
    };
    let mut property_value = None;
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            property_value = None;
            continue;
        };
        let Some(property_name) = three_lit_normals_object_property_name(property) else {
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

fn three_lit_normals_object_property_name<'a, 'node>(
    property: &'node oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'node str> {
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

fn three_lit_normals_static_member_property_name<'a, 'node>(
    member: &'node MemberExpression<'a>,
) -> Option<&'node str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => match &member.expression {
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
        },
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn three_lit_normals_is_nullish(expression: &Expression<'_>) -> bool {
    match three_lit_normals_strip_parentheses(expression) {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
        _ => false,
    }
}

fn three_lit_normals_static_number<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    three_lit_normals_static_number_inner(expression, ctx, &mut Vec::new())
}

fn three_lit_normals_static_number_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<f64> {
    let expression = three_lit_normals_strip_parentheses(expression);
    let value = match expression {
        Expression::NumericLiteral(number) => number.value,
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) =>
        {
            let operand = three_lit_normals_static_number_inner(
                &unary.argument,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            if unary.operator == UnaryOperator::UnaryNegation {
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
            three_lit_normals_static_number_inner(initializer, ctx, visited_symbol_ids)?
        }
        Expression::BinaryExpression(binary) => {
            let left = three_lit_normals_static_number_inner(
                &binary.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            let right = three_lit_normals_static_number_inner(
                &binary.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            match binary.operator {
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

fn three_lit_normals_expression_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = three_lit_normals_strip_parentheses(expression);
    if let Expression::Identifier(identifier) = expression {
        return three_lit_normals_identifier_key(identifier, ctx, visited_symbol_ids);
    }
    if let Some(member) = expression.as_member_expression() {
        let property_name = three_lit_normals_static_member_property_name(member)?;
        if property_name.is_empty() {
            return None;
        }
        let object_key =
            three_lit_normals_expression_key(member.object(), ctx, visited_symbol_ids)?;
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

fn three_lit_normals_identifier_key(
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
                three_lit_normals_property_key_name(&property.key, property.computed)
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
                three_lit_normals_expression_key(initializer, ctx, visited_symbol_ids)
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
    let initializer = three_lit_normals_strip_parentheses(initializer);
    if matches!(initializer, Expression::Identifier(_))
        || initializer.as_member_expression().is_some()
    {
        return three_lit_normals_expression_key(initializer, ctx, visited_symbol_ids)
            .or(Some(symbol_key));
    }
    Some(symbol_key)
}

fn three_lit_normals_property_key_name<'a, 'node>(
    key: &'node oxc_ast::ast::PropertyKey<'a>,
    is_computed: bool,
) -> Option<&'node str> {
    if is_computed {
        return None;
    }
    match key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn three_lit_normals_api_reference_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_lit_normals_strip_parentheses(expression);
    if let Some(member) = expression.as_member_expression() {
        return three_lit_normals_module_namespace_has_canonical_wrapper_shape(
            member.object(),
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
            three_lit_normals_api_reference_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    destructured_binding_provenance(&declarator.id, symbol_id, declarator.init.as_ref())
        .is_some_and(|(_, initializer)| {
            three_lit_normals_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_lit_normals_module_namespace_has_canonical_wrapper_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = three_lit_normals_strip_parentheses(expression);
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
            three_lit_normals_module_namespace_has_canonical_wrapper_shape(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_lit_normals_strip_parentheses<'a, 'node>(
    mut expression: &'node Expression<'a>,
) -> &'node Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}
