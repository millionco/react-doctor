use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ObjectPropertyKind, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule};

const SHADER_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] = ["RawShaderMaterial", "ShaderMaterial"];
const THREE_MODULE_SOURCES: [&str; 3] = ["three", "three-stdlib", "three/"];
const STATIC_SHADER_MATERIAL_PROPERTY_NAMES: [&str; 11] = [
    "clipping",
    "fog",
    "fragmentShader",
    "glslVersion",
    "lights",
    "morphNormals",
    "morphTargets",
    "skinning",
    "transmission",
    "uniforms",
    "vertexShader",
];
#[derive(Debug, Default, Clone)]
pub struct ThreeShaderValidUniformDefinitions;

declare_oxc_lint!(
    /// Require ShaderMaterial uniforms to use Three.js uniform definitions.
    ThreeShaderValidUniformDefinitions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader uniform has an invalid JavaScript definition.",
);

impl Rule for ThreeShaderValidUniformDefinitions {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::NewExpression(new_expression) = node.kind() else {
                continue;
            };
            if !SHADER_MATERIAL_CONSTRUCTOR_NAMES
                .iter()
                .any(|constructor_name| {
                    module_api_reference_matches(
                        &new_expression.callee,
                        constructor_name,
                        &THREE_MODULE_SOURCES,
                        &property_write_analysis,
                        ctx,
                    )
                })
            {
                continue;
            }
            let Some(options_expression) = new_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(options_object) = resolve_stable_shader_options_object(
                options_expression,
                node,
                &property_write_analysis,
                ctx,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            let Some(Some(uniforms_expression)) = effective_uniforms_expression(options_object)
            else {
                continue;
            };
            let Some(uniforms_object) = resolve_static_uniforms_object(
                uniforms_expression,
                node,
                &property_write_analysis,
                ctx,
            ) else {
                continue;
            };
            let Some(uniform_properties) = effective_object_properties(uniforms_object) else {
                continue;
            };
            for property in uniform_properties {
                let Some(uniform_name) = static_shader_property_name(property) else {
                    continue;
                };
                if property.kind != oxc_ast::ast::PropertyKind::Init || property.method {
                    continue;
                }
                if is_static_three_uniform_definition(
                    &property.value,
                    node,
                    &property_write_analysis,
                    ctx,
                ) {
                    continue;
                }
                let expression = property.value.get_inner_expression();
                let is_provably_invalid_definition = matches!(
                    expression,
                    Expression::ArrayExpression(_)
                        | Expression::ArrowFunctionExpression(_)
                        | Expression::FunctionExpression(_)
                        | Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::BigIntLiteral(_)
                        | Expression::RegExpLiteral(_)
                        | Expression::StringLiteral(_)
                        | Expression::TemplateLiteral(_)
                );
                if !is_provably_invalid_definition
                    && resolve_stable_object_expression(
                        &property.value,
                        &["value"],
                        node,
                        &property_write_analysis,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                    .is_none()
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "Uniform {uniform_name} is not a {{ value: ... }} definition, so Three.js cannot upload its value"
                    ))
                    .with_label(property.value.span()),
                );
            }
        }
    }
}

fn resolve_stable_shader_options_object<'a>(
    expression: &Expression<'a>,
    reference_node: &crate::AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let Expression::ObjectExpression(object_expression) = expression {
        let AstKind::ObjectExpression(object_expression) =
            ctx.nodes().get_node(object_expression.node_id()).kind()
        else {
            return None;
        };
        return Some(object_expression);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id)
        || shader_options_symbol_has_write_before(
            symbol_id,
            reference_node,
            property_write_analysis,
            ctx,
        )
        || STATIC_SHADER_MATERIAL_PROPERTY_NAMES
            .iter()
            .any(|property_name| {
                has_possible_static_property_write_before(
                    identifier,
                    property_name,
                    reference_node,
                    property_write_analysis,
                    ctx,
                )
            })
    {
        return None;
    }
    let initializer = shader_options_symbol_initializer(symbol_id, ctx)?;
    resolve_stable_shader_options_object(
        initializer,
        reference_node,
        property_write_analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn shader_options_symbol_has_write_before<'a>(
    symbol_id: SymbolId,
    reference_node: &crate::AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            can_node_execute_before(
                ctx.nodes().get_node(reference.node_id()),
                reference_node,
                property_write_analysis,
                ctx,
            )
        })
}

fn shader_options_symbol_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::VariableDeclarator(declarator) => binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        ),
        AstKind::FormalParameter(parameter) => {
            binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None)
        }
        _ => None,
    }
}

fn effective_uniforms_expression<'a>(
    options: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<Option<&'a Expression<'a>>> {
    let mut unresolved_property_names =
        FxHashSet::from_iter(STATIC_SHADER_MATERIAL_PROPERTY_NAMES.iter().copied());
    let mut uniforms = None;
    for property in options.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let property_name = static_shader_property_name(property)?;
        if !unresolved_property_names.remove(property_name) {
            continue;
        }
        if property.kind != oxc_ast::ast::PropertyKind::Init || property.method {
            continue;
        }
        if property_name == "uniforms" {
            uniforms = Some(&property.value);
        }
    }
    Some(uniforms)
}

fn static_shader_property_name<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) if !property.computed => {
            Some(identifier.name.as_str())
        }
        PropertyKey::StringLiteral(literal) if !literal.value.is_empty() => {
            Some(literal.value.as_str())
        }
        PropertyKey::TemplateLiteral(template)
            if property.computed && template.expressions.is_empty() =>
        {
            template.quasis.first().and_then(|quasi| {
                let value = quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str());
                (!value.is_empty()).then_some(value)
            })
        }
        _ => None,
    }
}

fn resolve_static_uniforms_object<'a>(
    expression: &'a Expression<'a>,
    reference_node: &crate::AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let initial_object = resolve_stable_object_expression(
        expression,
        &[],
        reference_node,
        property_write_analysis,
        ctx,
        &mut FxHashSet::default(),
    )?;
    let properties = effective_object_properties(initial_object)?;
    let property_names = properties
        .iter()
        .map(|property| static_shader_property_name(property))
        .collect::<Option<Vec<_>>>()?;
    resolve_stable_object_expression(
        expression,
        &property_names,
        reference_node,
        property_write_analysis,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn resolve_stable_object_expression<'a>(
    expression: &'a Expression<'a>,
    watched_property_names: &[&str],
    reference_node: &crate::AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let Expression::ObjectExpression(object_expression) = expression {
        let AstKind::ObjectExpression(object_expression) =
            ctx.nodes().get_node(object_expression.node_id()).kind()
        else {
            return None;
        };
        return Some(object_expression);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id)
        || shader_options_symbol_has_write_before(
            symbol_id,
            reference_node,
            property_write_analysis,
            ctx,
        )
        || watched_property_names.iter().any(|property_name| {
            has_possible_static_property_write_before(
                identifier,
                property_name,
                reference_node,
                property_write_analysis,
                ctx,
            )
        })
    {
        return None;
    }
    let initializer = shader_options_symbol_initializer(symbol_id, ctx)?;
    resolve_stable_object_expression(
        initializer,
        watched_property_names,
        reference_node,
        property_write_analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn effective_object_properties<'a>(
    object: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<Vec<&'a oxc_ast::ast::ObjectProperty<'a>>> {
    let mut properties = Vec::new();
    collect_effective_object_properties(object, &mut properties, &mut FxHashMap::default())?;
    Some(properties)
}

fn collect_effective_object_properties<'a>(
    object: &'a oxc_ast::ast::ObjectExpression<'a>,
    properties: &mut Vec<&'a oxc_ast::ast::ObjectProperty<'a>>,
    property_index_by_name: &mut FxHashMap<&'a str, usize>,
) -> Option<()> {
    for property in &object.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                let property_name = static_shader_property_name(property)?;
                if let Some(existing_index) = property_index_by_name.get(property_name).copied() {
                    properties[existing_index] = property;
                } else {
                    property_index_by_name.insert(property_name, properties.len());
                    properties.push(property);
                }
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                let Expression::ObjectExpression(spread_object) =
                    spread.argument.get_inner_expression()
                else {
                    return None;
                };
                collect_effective_object_properties(
                    spread_object,
                    properties,
                    property_index_by_name,
                )?;
            }
        }
    }
    Some(())
}

fn is_static_three_uniform_definition<'a>(
    expression: &'a Expression<'a>,
    reference_node: &crate::AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if let Expression::NewExpression(new_expression) = expression.get_inner_expression()
        && module_api_reference_matches(
            &new_expression.callee,
            "Uniform",
            &THREE_MODULE_SOURCES,
            property_write_analysis,
            ctx,
        )
    {
        return true;
    }
    let Some(definition_object) = resolve_stable_object_expression(
        expression,
        &["value"],
        reference_node,
        property_write_analysis,
        ctx,
        &mut FxHashSet::default(),
    ) else {
        return false;
    };
    let Some(properties) = effective_object_properties(definition_object) else {
        return false;
    };
    properties.into_iter().any(|property| {
        property.kind == oxc_ast::ast::PropertyKind::Init
            && !property.method
            && static_shader_property_name(property) == Some("value")
    })
}
