use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, Expression},
};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const GEOMETRY_RESOURCE_HOST_NAMES: [&str; 9] = [
    "batchedMesh",
    "instancedMesh",
    "line",
    "lineLoop",
    "lineSegments",
    "mesh",
    "points",
    "primitive",
    "skinnedMesh",
];
const MATERIAL_RESOURCE_HOST_NAMES: [&str; 10] = [
    "batchedMesh",
    "instancedMesh",
    "line",
    "lineLoop",
    "lineSegments",
    "mesh",
    "points",
    "primitive",
    "skinnedMesh",
    "sprite",
];
const GEOMETRY_RESOURCE_METHODS: [&str; 17] = [
    "applyMatrix4",
    "applyQuaternion",
    "center",
    "clone",
    "copy",
    "deleteAttribute",
    "lookAt",
    "rotateX",
    "rotateY",
    "rotateZ",
    "scale",
    "setAttribute",
    "setFromPoints",
    "setIndex",
    "setIndirect",
    "toNonIndexed",
    "translate",
];
const MATERIAL_RESOURCE_METHODS: [&str; 2] = ["clone", "copy"];
const GEOMETRY_OWNER_CONSTRUCTORS: [&str; 8] = [
    "BatchedMesh",
    "InstancedMesh",
    "Line",
    "LineLoop",
    "LineSegments",
    "Mesh",
    "Points",
    "SkinnedMesh",
];
const MATERIAL_OWNER_CONSTRUCTORS: [&str; 9] = [
    "BatchedMesh",
    "InstancedMesh",
    "Line",
    "LineLoop",
    "LineSegments",
    "Mesh",
    "Points",
    "SkinnedMesh",
    "Sprite",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoInlineResourceProp;

#[derive(Clone, Copy, PartialEq, Eq)]
enum InlineResourceKind {
    Geometry,
    Material,
}

impl InlineResourceKind {
    fn property_name(self) -> &'static str {
        match self {
            Self::Geometry => "geometry",
            Self::Material => "material",
        }
    }

    fn constructor_suffix(self) -> &'static str {
        match self {
            Self::Geometry => "Geometry",
            Self::Material => "Material",
        }
    }

    fn host_names(self) -> &'static [&'static str] {
        match self {
            Self::Geometry => &GEOMETRY_RESOURCE_HOST_NAMES,
            Self::Material => &MATERIAL_RESOURCE_HOST_NAMES,
        }
    }

    fn resource_methods(self) -> &'static [&'static str] {
        match self {
            Self::Geometry => &GEOMETRY_RESOURCE_METHODS,
            Self::Material => &MATERIAL_RESOURCE_METHODS,
        }
    }

    fn owner_constructors(self) -> &'static [&'static str] {
        match self {
            Self::Geometry => &GEOMETRY_OWNER_CONSTRUCTORS,
            Self::Material => &MATERIAL_OWNER_CONSTRUCTORS,
        }
    }
}

impl RuleMeta for R3FNoInlineResourceProp {
    const NAME: &'static str = "r3f-no-inline-resource-prop";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow inline Three.js geometry and material resource props in R3F JSX.",
    };
}

impl Rule for R3FNoInlineResourceProp {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let candidate_node_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                let host_name = opening_element.name.get_identifier_name()?;
                let has_relevant_attribute =
                    [InlineResourceKind::Geometry, InlineResourceKind::Material]
                        .iter()
                        .any(|resource_kind| {
                            resource_kind.host_names().contains(&host_name.as_str())
                                && get_authoritative_jsx_attribute(
                                    opening_element,
                                    resource_kind.property_name(),
                                    true,
                                )
                                .and_then(|attribute| jsx_attribute_expression(attribute))
                                .is_some()
                        });
                (has_relevant_attribute && find_render_phase_component_or_hook(node, ctx).is_some())
                    .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if candidate_node_ids.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        for node_id in candidate_node_ids {
            let node = ctx.nodes().get_node(node_id);
            if is_inside_stable_r3f_react_initializer(node, &analysis, ctx) {
                continue;
            }
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            report_inline_resource_prop(
                opening_element,
                InlineResourceKind::Geometry,
                &analysis,
                ctx,
            );
            report_inline_resource_prop(
                opening_element,
                InlineResourceKind::Material,
                &analysis,
                ctx,
            );
        }
    }
}

fn report_inline_resource_prop<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    resource_kind: InlineResourceKind,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) {
    let Some(host_name) = opening_element.name.get_identifier_name() else {
        return;
    };
    if !resource_kind.host_names().contains(&host_name.as_str()) {
        return;
    }
    let Some(expression) =
        get_authoritative_jsx_attribute(opening_element, resource_kind.property_name(), true)
            .and_then(|attribute| jsx_attribute_expression(attribute))
    else {
        return;
    };
    if !has_fresh_three_resource(expression, resource_kind, analysis, ctx, &mut Vec::new()) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "This Three.js {} is reconstructed on every React render, causing GPU resource churn and potentially leaving displaced prop resources outside declarative disposal. Reuse a stable resource",
            resource_kind.property_name()
        ))
        .with_label(oxc_span::GetSpan::span(expression)),
    );
}

fn has_fresh_three_resource<'a>(
    expression: &Expression<'a>,
    resource_kind: InlineResourceKind,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::NewExpression(new_expression) => {
            inline_three_api_name(&new_expression.callee, analysis, ctx).is_some_and(
                |constructor_name| constructor_name.ends_with(resource_kind.constructor_suffix()),
            )
        }
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) = inline_resource_const_initializer(identifier, ctx)
            else {
                return false;
            };
            if ctx
                .scoping()
                .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                .is_top()
                || visited_symbol_ids.contains(&symbol_id)
            {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            has_fresh_three_resource(
                initializer,
                resource_kind,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            has_fresh_three_resource(
                &conditional_expression.consequent,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) || has_fresh_three_resource(
                &conditional_expression.alternate,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical_expression) => {
            has_fresh_three_resource(
                &logical_expression.left,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) || has_fresh_three_resource(
                &logical_expression.right,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::ArrayExpression(array_expression)
            if resource_kind == InlineResourceKind::Material =>
        {
            array_expression.elements.iter().any(|element| {
                ArrayExpressionElement::as_expression(element).is_some_and(|element_expression| {
                    has_fresh_three_resource(
                        element_expression,
                        resource_kind,
                        analysis,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                })
            })
        }
        Expression::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            let Some(method_name) = member_expression.static_property_name() else {
                return false;
            };
            if method_name == "clone" {
                return has_three_resource_provenance(
                    member_expression.object(),
                    resource_kind,
                    analysis,
                    ctx,
                    visited_symbol_ids,
                );
            }
            if resource_kind == InlineResourceKind::Geometry && method_name == "toNonIndexed" {
                return has_fresh_three_resource(
                    member_expression.object(),
                    resource_kind,
                    analysis,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ) || has_proven_indexed_three_geometry(
                    member_expression.object(),
                    analysis,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                );
            }
            resource_kind.resource_methods().contains(&method_name)
                && has_fresh_three_resource(
                    member_expression.object(),
                    resource_kind,
                    analysis,
                    ctx,
                    visited_symbol_ids,
                )
        }
        _ => false,
    }
}

fn has_three_resource_provenance<'a>(
    expression: &Expression<'a>,
    resource_kind: InlineResourceKind,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return member_expression.static_property_name() == Some(resource_kind.property_name())
            && has_three_resource_owner_provenance(
                member_expression.object(),
                resource_kind,
                analysis,
                ctx,
                visited_symbol_ids,
            );
    }
    match expression {
        Expression::NewExpression(new_expression) => {
            inline_three_api_name(&new_expression.callee, analysis, ctx).is_some_and(
                |constructor_name| constructor_name.ends_with(resource_kind.constructor_suffix()),
            )
        }
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) = inline_resource_const_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            has_three_resource_provenance(
                initializer,
                resource_kind,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::ConditionalExpression(conditional_expression) => {
            has_three_resource_provenance(
                &conditional_expression.consequent,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) && has_three_resource_provenance(
                &conditional_expression.alternate,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical_expression) => {
            has_three_resource_provenance(
                &logical_expression.left,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) && has_three_resource_provenance(
                &logical_expression.right,
                resource_kind,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            member_expression
                .static_property_name()
                .is_some_and(|method_name| resource_kind.resource_methods().contains(&method_name))
                && has_three_resource_provenance(
                    member_expression.object(),
                    resource_kind,
                    analysis,
                    ctx,
                    visited_symbol_ids,
                )
        }
        _ => false,
    }
}

fn has_three_resource_owner_provenance<'a>(
    expression: &Expression<'a>,
    resource_kind: InlineResourceKind,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::NewExpression(new_expression) => {
            inline_three_api_name(&new_expression.callee, analysis, ctx).is_some_and(
                |constructor_name| {
                    resource_kind
                        .owner_constructors()
                        .contains(&constructor_name.as_str())
                },
            )
        }
        Expression::Identifier(identifier) => {
            let Some((symbol_id, initializer)) = inline_resource_const_initializer(identifier, ctx)
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            has_three_resource_owner_provenance(
                initializer,
                resource_kind,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            member_expression.static_property_name() == Some("clone")
                && has_three_resource_owner_provenance(
                    member_expression.object(),
                    resource_kind,
                    analysis,
                    ctx,
                    visited_symbol_ids,
                )
        }
        _ => false,
    }
}

fn has_proven_indexed_three_geometry<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some((symbol_id, initializer)) = inline_resource_const_initializer(identifier, ctx)
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        return has_proven_indexed_three_geometry(initializer, analysis, ctx, visited_symbol_ids);
    }
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    if member_expression.static_property_name() != Some("setIndex") {
        return false;
    }
    let Some(index_expression) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    is_proven_non_null_index(index_expression, ctx, &mut Vec::new())
        && has_three_resource_provenance(
            member_expression.object(),
            InlineResourceKind::Geometry,
            analysis,
            ctx,
            &mut Vec::new(),
        )
}

fn is_proven_non_null_index<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrayExpression(_) | Expression::NewExpression(_)
    ) || (!matches!(expression, Expression::NullLiteral(_)) && expression.is_literal())
    {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some((symbol_id, initializer)) = inline_resource_const_initializer(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    is_proven_non_null_index(initializer, ctx, visited_symbol_ids)
}

fn inline_resource_const_initializer<'a, 'ctx>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<(oxc_semantic::SymbolId, &'ctx Expression<'a>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
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
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    Some((symbol_id, declarator.init.as_ref()?))
}

fn inline_three_api_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = inline_three_api_name_candidate(expression, ctx, &mut Vec::new())?;
    module_api_reference_matches(expression, &api_name, &THREE_MODULES, analysis, ctx)
        .then_some(api_name)
}

fn inline_three_api_name_candidate<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return member_expression
            .static_property_name()
            .map(ToString::to_string);
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
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return matches!(
            &qualified_name.left,
            oxc_ast::ast::TSTypeName::IdentifierReference(_)
        )
        .then(|| qualified_name.right.name.to_string());
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
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        {
            return inline_three_api_name_candidate(
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
