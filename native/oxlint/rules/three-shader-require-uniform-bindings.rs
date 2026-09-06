use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, Expression, ObjectPropertyKind, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

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
pub struct ThreeShaderRequireUniformBindings;

declare_oxc_lint!(
    /// Require every statically used custom GLSL uniform to have a material binding.
    ThreeShaderRequireUniformBindings,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader uniform has no material binding.",
);

impl Rule for ThreeShaderRequireUniformBindings {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::NewExpression(new_expression) = node.kind() else {
                continue;
            };
            let constructor_name = if module_api_reference_matches(
                &new_expression.callee,
                "RawShaderMaterial",
                &THREE_MODULE_SOURCES,
                &property_write_analysis,
                ctx,
            ) {
                "RawShaderMaterial"
            } else if module_api_reference_matches(
                &new_expression.callee,
                "ShaderMaterial",
                &THREE_MODULE_SOURCES,
                &property_write_analysis,
                ctx,
            ) {
                "ShaderMaterial"
            } else {
                continue;
            };
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
            let Some((uniforms, vertex_shader, fragment_shader)) =
                effective_material_expressions(options_object)
            else {
                continue;
            };
            let mut declarations = Vec::new();
            let mut declaration_names = FxHashSet::default();
            for shader_expression in [vertex_shader, fragment_shader].into_iter().flatten() {
                let Some(shader_source) =
                    resolve_static_shader_source(shader_expression, ctx, &mut FxHashSet::default())
                else {
                    continue;
                };
                let Some(shader_declarations) = glsl_uniform_declarations(&shader_source.text)
                else {
                    continue;
                };
                for declaration in shader_declarations {
                    if !declaration.is_statically_used
                        || declaration.name.starts_with("gl_")
                        || is_renderer_managed_uniform(
                            &declaration.name,
                            constructor_name,
                            options_object,
                        )
                    {
                        continue;
                    }
                    let utf16_offset = shader_source.text[..declaration.byte_offset]
                        .encode_utf16()
                        .count();
                    if declaration_names.insert(declaration.name.clone()) {
                        declarations
                            .push((declaration.name, shader_source.origin_span(utf16_offset)));
                    }
                }
            }
            if declarations.is_empty() {
                continue;
            }
            let uniform_names = declarations
                .iter()
                .map(|(uniform_name, _)| uniform_name.as_str())
                .collect::<Vec<_>>();
            let bound_uniform_names = if let Some(uniforms_expression) = uniforms {
                let Some(uniforms_object) = resolve_stable_object_expression(
                    uniforms_expression,
                    &uniform_names,
                    node,
                    &property_write_analysis,
                    ctx,
                    &mut FxHashSet::default(),
                ) else {
                    continue;
                };
                let Some(property_names) =
                    collect_authoritative_static_object_property_names(uniforms_object)
                else {
                    continue;
                };
                property_names
            } else {
                FxHashSet::default()
            };
            for (uniform_name, declaration_span) in declarations {
                if bound_uniform_names.contains(uniform_name.as_str()) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "GLSL uniform {uniform_name} has no matching entry in this material's uniforms object, so it keeps its default value"
                    ))
                    .with_label(declaration_span),
                );
            }
        }
    }
}

struct StaticShaderSourceSegment {
    start_offset: usize,
    end_offset: usize,
    span: Span,
}

struct StaticShaderSource {
    text: String,
    segments: Vec<StaticShaderSourceSegment>,
    fallback_span: Span,
}

impl StaticShaderSource {
    fn origin_span(&self, offset: usize) -> Span {
        self.segments
            .iter()
            .find(|segment| offset >= segment.start_offset && offset < segment.end_offset)
            .map_or(self.fallback_span, |segment| segment.span)
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

fn effective_material_expressions<'a>(
    options: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<(
    Option<&'a Expression<'a>>,
    Option<&'a Expression<'a>>,
    Option<&'a Expression<'a>>,
)> {
    let mut unresolved_property_names =
        FxHashSet::from_iter(STATIC_SHADER_MATERIAL_PROPERTY_NAMES.iter().copied());
    let mut fragment_shader = None;
    let mut uniforms = None;
    let mut vertex_shader = None;
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
        match property_name {
            "fragmentShader" => fragment_shader = Some(&property.value),
            "uniforms" => uniforms = Some(&property.value),
            "vertexShader" => vertex_shader = Some(&property.value),
            _ => {}
        }
    }
    Some((uniforms, vertex_shader, fragment_shader))
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

fn is_renderer_managed_uniform(
    uniform_name: &str,
    constructor_name: &str,
    options: &oxc_ast::ast::ObjectExpression<'_>,
) -> bool {
    if constructor_name != "ShaderMaterial"
        || !is_renderer_managed_uniform_name(uniform_name)
        || is_material_uniform_library_name(uniform_name)
    {
        return false;
    }
    let Some(required_feature) = managed_uniform_feature(uniform_name) else {
        return true;
    };
    effective_material_property(options, required_feature).is_some_and(|expression| {
        !matches!(
            expression.get_inner_expression(),
            Expression::BooleanLiteral(literal) if !literal.value
        )
    })
}

fn effective_material_property<'a>(
    options: &'a oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
) -> Option<&'a Expression<'a>> {
    for property in options.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if static_shader_property_name(property)? != property_name {
            continue;
        }
        return (property.kind == oxc_ast::ast::PropertyKind::Init && !property.method)
            .then_some(&property.value);
    }
    None
}

fn is_renderer_managed_uniform_name(uniform_name: &str) -> bool {
    matches!(
        uniform_name,
        "ambientLightColor"
            | "bindMatrix"
            | "bindMatrixInverse"
            | "boneTexture"
            | "boneTextureSize"
            | "cameraPosition"
            | "clippingPlanes"
            | "directionalLights"
            | "directionalLightShadows"
            | "directionalShadowMap"
            | "directionalShadowMatrix"
            | "fogColor"
            | "fogDensity"
            | "fogFar"
            | "fogNear"
            | "hemisphereLights"
            | "isOrthographic"
            | "lightProbe"
            | "logDepthBufFC"
            | "ltc_1"
            | "ltc_2"
            | "modelMatrix"
            | "modelViewMatrix"
            | "morphTargetBaseInfluence"
            | "morphTargetInfluences"
            | "morphTargetsTexture"
            | "morphTargetsTextureSize"
            | "normalMatrix"
            | "pointLights"
            | "pointLightShadows"
            | "pointShadowMap"
            | "pointShadowMatrix"
            | "probesMax"
            | "probesMin"
            | "probesResolution"
            | "probesSH"
            | "projectionMatrix"
            | "receiveShadow"
            | "rectAreaLights"
            | "spotLightMap"
            | "spotLightMatrix"
            | "spotLights"
            | "spotLightShadows"
            | "spotShadowMap"
            | "toneMappingExposure"
            | "transmissionSamplerMap"
            | "transmissionSamplerSize"
            | "viewMatrix"
    )
}

fn is_material_uniform_library_name(uniform_name: &str) -> bool {
    matches!(
        uniform_name,
        "ambientLightColor"
            | "directionalLights"
            | "directionalLightShadows"
            | "directionalShadowMap"
            | "directionalShadowMatrix"
            | "fogColor"
            | "fogDensity"
            | "fogFar"
            | "fogNear"
            | "hemisphereLights"
            | "lightProbe"
            | "ltc_1"
            | "ltc_2"
            | "pointLights"
            | "pointLightShadows"
            | "pointShadowMap"
            | "pointShadowMatrix"
            | "rectAreaLights"
            | "spotLightMap"
            | "spotLightMatrix"
            | "spotLights"
            | "spotLightShadows"
            | "spotShadowMap"
    )
}

fn managed_uniform_feature(uniform_name: &str) -> Option<&'static str> {
    match uniform_name {
        "ambientLightColor"
        | "directionalLights"
        | "directionalLightShadows"
        | "directionalShadowMap"
        | "directionalShadowMatrix"
        | "hemisphereLights"
        | "lightProbe"
        | "ltc_1"
        | "ltc_2"
        | "pointLights"
        | "pointLightShadows"
        | "pointShadowMap"
        | "pointShadowMatrix"
        | "probesMax"
        | "probesMin"
        | "probesResolution"
        | "probesSH"
        | "receiveShadow"
        | "rectAreaLights"
        | "spotLightMap"
        | "spotLightMatrix"
        | "spotLights"
        | "spotLightShadows"
        | "spotShadowMap" => Some("lights"),
        "bindMatrix" | "bindMatrixInverse" | "boneTexture" | "boneTextureSize" => Some("skinning"),
        "clippingPlanes" => Some("clipping"),
        "fogColor" | "fogDensity" | "fogFar" | "fogNear" => Some("fog"),
        "morphTargetBaseInfluence"
        | "morphTargetInfluences"
        | "morphTargetsTexture"
        | "morphTargetsTextureSize" => Some("morphTargets"),
        "transmissionSamplerMap" | "transmissionSamplerSize" => Some("transmission"),
        _ => None,
    }
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

fn collect_authoritative_static_object_property_names<'a>(
    object: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<FxHashSet<&'a str>> {
    let mut property_names = FxHashSet::default();
    for property in object.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        property_names.insert(static_shader_property_name(property)?);
    }
    Some(property_names)
}

fn resolve_static_shader_source<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<StaticShaderSource> {
    let expression = expression.get_inner_expression();
    if let Some(text) = static_shader_string(expression) {
        let text = text.to_string();
        let text_length = text.encode_utf16().count();
        return Some(StaticShaderSource {
            segments: (text_length > 0)
                .then(|| StaticShaderSourceSegment {
                    start_offset: 0,
                    end_offset: text_length,
                    span: expression.span(),
                })
                .into_iter()
                .collect(),
            fallback_span: expression.span(),
            text,
        });
    }
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        return resolve_static_shader_source(declarator.init.as_ref()?, ctx, visited_symbol_ids);
    }
    if let Expression::BinaryExpression(binary) = expression
        && binary.operator == oxc_syntax::operator::BinaryOperator::Addition
    {
        let left =
            resolve_static_shader_source(&binary.left, ctx, &mut visited_symbol_ids.clone())?;
        let right =
            resolve_static_shader_source(&binary.right, ctx, &mut visited_symbol_ids.clone())?;
        return Some(combine_shader_sources(
            [left, right],
            None,
            expression.span(),
        ));
    }
    let Expression::CallExpression(call_expression) = expression else {
        return None;
    };
    let member_expression = call_expression.callee.as_member_expression()?;
    if member_expression.static_property_name() != Some("join")
        || call_expression.arguments.len() > 1
    {
        return None;
    }
    let Expression::ArrayExpression(array_expression) =
        member_expression.object().get_inner_expression()
    else {
        return None;
    };
    let separator = if let Some(argument) = call_expression.arguments.first() {
        resolve_static_shader_source(
            argument.as_expression()?,
            ctx,
            &mut visited_symbol_ids.clone(),
        )?
    } else {
        StaticShaderSource {
            text: ",".to_string(),
            segments: Vec::new(),
            fallback_span: expression.span(),
        }
    };
    let mut element_sources = Vec::with_capacity(array_expression.elements.len());
    for element in &array_expression.elements {
        let element = match element {
            ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_) => {
                return None;
            }
            element => element.as_expression()?,
        };
        element_sources.push(resolve_static_shader_source(
            element,
            ctx,
            &mut visited_symbol_ids.clone(),
        )?);
    }
    Some(combine_shader_sources(
        element_sources,
        Some(separator),
        expression.span(),
    ))
}

fn static_shader_string<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str()),
            )
        }
        _ => None,
    }
}

fn combine_shader_sources(
    sources: impl IntoIterator<Item = StaticShaderSource>,
    separator: Option<StaticShaderSource>,
    fallback_span: Span,
) -> StaticShaderSource {
    let mut text = String::new();
    let mut segments = Vec::new();
    let mut utf16_offset = 0;
    for (source_index, source) in sources.into_iter().enumerate() {
        if source_index > 0
            && let Some(separator) = &separator
        {
            append_shader_source(separator, &mut text, &mut segments, &mut utf16_offset);
        }
        append_shader_source(&source, &mut text, &mut segments, &mut utf16_offset);
    }
    StaticShaderSource {
        text,
        segments,
        fallback_span,
    }
}

fn append_shader_source(
    source: &StaticShaderSource,
    text: &mut String,
    segments: &mut Vec<StaticShaderSourceSegment>,
    utf16_offset: &mut usize,
) {
    segments.extend(
        source
            .segments
            .iter()
            .map(|segment| StaticShaderSourceSegment {
                start_offset: segment.start_offset + *utf16_offset,
                end_offset: segment.end_offset + *utf16_offset,
                span: segment.span,
            }),
    );
    text.push_str(&source.text);
    *utf16_offset += source.text.encode_utf16().count();
}

struct GlslUniformDeclaration {
    byte_offset: usize,
    declaration_token_index: usize,
    is_statically_used: bool,
    name: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GlslTokenKind {
    Identifier,
    Symbol,
}

#[derive(Clone, Copy)]
struct GlslToken<'a> {
    kind: GlslTokenKind,
    start: usize,
    text: &'a str,
}

fn glsl_uniform_declarations(source: &str) -> Option<Vec<GlslUniformDeclaration>> {
    let source_without_comments = mask_glsl_comments(source);
    if has_glsl_directive(
        &source_without_comments,
        &["if", "ifdef", "ifndef", "elif", "else", "endif"],
    ) {
        return None;
    }
    let token_source = mask_glsl_preprocessor_directives(&source_without_comments);
    let tokens = tokenize_glsl(&token_source)?;
    let mut declarations = Vec::new();
    let mut brace_depth = 0usize;
    let mut statement_start = 0;
    for token_index in 0..tokens.len() {
        match tokens[token_index].text {
            "{" => brace_depth += 1,
            "}" => {
                brace_depth = brace_depth.checked_sub(1)?;
                if brace_depth == 0 {
                    statement_start = token_index + 1;
                }
            }
            ";" if brace_depth == 0 => {
                collect_uniform_declarations_from_statement(
                    &tokens,
                    statement_start,
                    token_index,
                    &mut declarations,
                )?;
                statement_start = token_index + 1;
            }
            _ => {}
        }
    }
    if brace_depth != 0 {
        return None;
    }
    let declaration_token_indices = declarations
        .iter()
        .map(|declaration| declaration.declaration_token_index)
        .collect::<FxHashSet<_>>();
    for declaration in &mut declarations {
        declaration.is_statically_used = tokens.iter().enumerate().any(|(token_index, token)| {
            token.kind == GlslTokenKind::Identifier
                && token.text == declaration.name
                && !declaration_token_indices.contains(&token_index)
                && tokens
                    .get(token_index.wrapping_sub(1))
                    .map(|token| token.text)
                    != Some(".")
                && !local_binding_shadows_identifier(&token_source, &declaration.name, token.start)
        });
    }
    Some(declarations)
}

fn collect_uniform_declarations_from_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    declarations: &mut Vec<GlslUniformDeclaration>,
) -> Option<()> {
    if start >= end {
        return Some(());
    }
    let mut token_index = start;
    while matches!(
        tokens.get(token_index).map(|token| token.text),
        Some("layout" | "subroutine")
    ) && tokens.get(token_index + 1).map(|token| token.text) == Some("(")
    {
        token_index = matching_token(tokens, token_index + 1, "(", ")")? + 1;
    }
    let mut is_uniform = false;
    while tokens
        .get(token_index)
        .is_some_and(|token| is_glsl_declaration_qualifier(token.text))
    {
        is_uniform |= tokens[token_index].text == "uniform";
        token_index += 1;
    }
    if !is_uniform
        || tokens.get(token_index).map(|token| token.kind) != Some(GlslTokenKind::Identifier)
        || tokens[token_index].text == "struct"
    {
        return Some(());
    }
    token_index += 1;
    while tokens.get(token_index).map(|token| token.text) == Some("[") {
        token_index = matching_token(tokens, token_index, "[", "]")? + 1;
    }
    let declaration_start = tokens[start].start;
    let mut declaration_index = 0;
    while token_index < end {
        if tokens[token_index].kind != GlslTokenKind::Identifier {
            return Some(());
        }
        let declaration_token_index = token_index;
        let name_token = tokens[token_index];
        token_index += 1;
        if tokens.get(token_index).map(|token| token.text) == Some("(") {
            return Some(());
        }
        while tokens.get(token_index).map(|token| token.text) == Some("[") {
            token_index = matching_token(tokens, token_index, "[", "]")? + 1;
        }
        declarations.push(GlslUniformDeclaration {
            byte_offset: if declaration_index == 0 {
                declaration_start
            } else {
                name_token.start
            },
            declaration_token_index,
            is_statically_used: false,
            name: name_token.text.to_string(),
        });
        declaration_index += 1;
        if tokens.get(token_index).map(|token| token.text) == Some("=") {
            token_index = next_top_level_comma(tokens, token_index + 1, end)?;
        }
        if token_index >= end {
            break;
        }
        if tokens[token_index].text != "," {
            return Some(());
        }
        token_index += 1;
    }
    Some(())
}

fn next_top_level_comma(tokens: &[GlslToken<'_>], start: usize, end: usize) -> Option<usize> {
    let mut delimiters = Vec::new();
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            "," if delimiters.is_empty() => return Some(token_index),
            _ => {}
        }
    }
    delimiters.is_empty().then_some(end)
}

fn is_glsl_declaration_qualifier(token: &str) -> bool {
    matches!(
        token,
        "const"
            | "attribute"
            | "uniform"
            | "varying"
            | "buffer"
            | "shared"
            | "coherent"
            | "volatile"
            | "restrict"
            | "readonly"
            | "writeonly"
            | "atomic_uint"
            | "in"
            | "out"
            | "inout"
            | "centroid"
            | "patch"
            | "sample"
            | "flat"
            | "smooth"
            | "noperspective"
            | "highp"
            | "mediump"
            | "lowp"
            | "invariant"
            | "precise"
    )
}

struct GlslShadowToken<'a> {
    is_identifier: bool,
    text: &'a str,
}

fn local_binding_shadows_identifier(source: &str, name: &str, use_offset: usize) -> bool {
    let bytes = source.as_bytes();
    let mut block_starts = Vec::new();
    for (byte_offset, byte) in bytes[..use_offset].iter().copied().enumerate() {
        match byte {
            b'{' => block_starts.push(byte_offset + 1),
            b'}' => {
                block_starts.pop();
            }
            _ => {}
        }
    }
    block_starts.into_iter().any(|block_start| {
        glsl_tokens_declare_name(
            &tokenize_glsl_shadow_source(&source[block_start..use_offset + name.len()]),
            name,
        ) || glsl_block_header_declares_name(source, block_start - 1, name)
    })
}

fn glsl_block_header_declares_name(source: &str, opening_brace: usize, name: &str) -> bool {
    let bytes = source.as_bytes();
    let Some(closing_parenthesis) = bytes[..opening_brace]
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
    else {
        return false;
    };
    if bytes[closing_parenthesis] != b')' {
        return false;
    }
    let Some(opening_parenthesis) =
        matching_opening_delimiter(bytes, closing_parenthesis, b'(', b')')
    else {
        return false;
    };
    glsl_tokens_declare_name(
        &tokenize_glsl_shadow_source(&source[opening_parenthesis + 1..closing_parenthesis]),
        name,
    )
}

fn glsl_tokens_declare_name(tokens: &[GlslShadowToken<'_>], name: &str) -> bool {
    tokens.iter().enumerate().any(|(token_index, token)| {
        if !token.is_identifier || token.text != name || token_index == 0 {
            return false;
        }
        let mut type_index = token_index - 1;
        while type_index > 0 && is_glsl_declaration_qualifier(tokens[type_index].text) {
            type_index -= 1;
        }
        let type_token = &tokens[type_index];
        if !type_token.is_identifier || matches!(type_token.text, "return" | "case" | "else") {
            return false;
        }
        type_index == 0
            || matches!(tokens[type_index - 1].text, ";" | "{" | "}" | "(" | ",")
            || is_glsl_declaration_qualifier(tokens[type_index - 1].text)
    })
}

fn tokenize_glsl_shadow_source(source: &str) -> Vec<GlslShadowToken<'_>> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut byte_offset = 0;
    while byte_offset < bytes.len() {
        if bytes[byte_offset].is_ascii_whitespace() {
            byte_offset += 1;
            continue;
        }
        let token_start = byte_offset;
        let is_identifier = is_identifier_start(bytes[byte_offset]);
        byte_offset += 1;
        if is_identifier {
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
        }
        tokens.push(GlslShadowToken {
            is_identifier,
            text: &source[token_start..byte_offset],
        });
    }
    tokens
}

fn matching_opening_delimiter(
    bytes: &[u8],
    closing_offset: usize,
    opening: u8,
    closing: u8,
) -> Option<usize> {
    let mut depth = 0;
    for byte_offset in (0..=closing_offset).rev() {
        if bytes[byte_offset] == closing {
            depth += 1;
        } else if bytes[byte_offset] == opening {
            depth -= 1;
            if depth == 0 {
                return Some(byte_offset);
            }
        }
    }
    None
}

fn mask_glsl_comments(source: &str) -> String {
    let mut bytes = source.as_bytes().to_vec();
    let mut byte_offset = 0;
    let mut is_block_comment = false;
    let mut is_line_comment = false;
    while byte_offset < bytes.len() {
        let byte = bytes[byte_offset];
        let next_byte = bytes.get(byte_offset + 1).copied();
        if is_line_comment {
            if matches!(byte, b'\r' | b'\n') {
                is_line_comment = false;
            } else {
                bytes[byte_offset] = b' ';
            }
        } else if is_block_comment {
            if byte == b'*' && next_byte == Some(b'/') {
                bytes[byte_offset] = b' ';
                bytes[byte_offset + 1] = b' ';
                byte_offset += 1;
                is_block_comment = false;
            } else if !matches!(byte, b'\r' | b'\n') {
                bytes[byte_offset] = b' ';
            }
        } else if byte == b'/' && next_byte == Some(b'/') {
            bytes[byte_offset] = b' ';
            bytes[byte_offset + 1] = b' ';
            byte_offset += 1;
            is_line_comment = true;
        } else if byte == b'/' && next_byte == Some(b'*') {
            bytes[byte_offset] = b' ';
            bytes[byte_offset + 1] = b' ';
            byte_offset += 1;
            is_block_comment = true;
        }
        byte_offset += 1;
    }
    String::from_utf8(bytes).unwrap_or_default()
}

fn mask_glsl_preprocessor_directives(source: &str) -> String {
    let mut bytes = source.as_bytes().to_vec();
    let mut line_start = 0;
    let mut is_continuation = false;
    while line_start <= bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|byte| matches!(byte, b'\r' | b'\n'))
            .map_or(bytes.len(), |offset| line_start + offset);
        let line = &bytes[line_start..line_end];
        let is_directive = is_continuation
            || line.iter().find(|byte| !matches!(byte, b' ' | b'\t')) == Some(&b'#');
        is_continuation =
            is_directive && line.iter().rfind(|byte| !matches!(byte, b' ' | b'\t')) == Some(&b'\\');
        if is_directive {
            bytes[line_start..line_end].fill(b' ');
        }
        if line_end == bytes.len() {
            break;
        }
        line_start = if bytes[line_end] == b'\r' && bytes.get(line_end + 1) == Some(&b'\n') {
            line_end + 2
        } else {
            line_end + 1
        };
    }
    String::from_utf8(bytes).unwrap_or_default()
}

fn tokenize_glsl(source: &str) -> Option<Vec<GlslToken<'_>>> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut byte_offset = 0;
    while byte_offset < bytes.len() {
        if bytes[byte_offset].is_ascii_whitespace() {
            byte_offset += 1;
            continue;
        }
        let token_start = byte_offset;
        let kind = if is_identifier_start(bytes[byte_offset]) {
            byte_offset += 1;
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
            GlslTokenKind::Identifier
        } else {
            if !bytes[byte_offset].is_ascii_digit() && !is_glsl_punctuation_byte(bytes[byte_offset])
            {
                return None;
            }
            byte_offset += 1;
            GlslTokenKind::Symbol
        };
        tokens.push(GlslToken {
            kind,
            start: token_start,
            text: &source[token_start..byte_offset],
        });
    }
    delimiters_are_balanced(&tokens).then_some(tokens)
}

fn is_glsl_punctuation_byte(byte: u8) -> bool {
    matches!(
        byte,
        b'.' | b'+'
            | b'-'
            | b'~'
            | b'!'
            | b'*'
            | b'/'
            | b'%'
            | b'<'
            | b'>'
            | b'='
            | b'&'
            | b'^'
            | b'|'
            | b'?'
            | b':'
            | b','
            | b';'
            | b'{'
            | b'}'
            | b'['
            | b']'
            | b'('
            | b')'
    )
}

fn matching_token(
    tokens: &[GlslToken<'_>],
    opening_index: usize,
    opening: &str,
    closing: &str,
) -> Option<usize> {
    if tokens.get(opening_index).map(|token| token.text) != Some(opening) {
        return None;
    }
    let mut depth = 0;
    for (token_index, token) in tokens.iter().enumerate().skip(opening_index) {
        if token.text == opening {
            depth += 1;
        } else if token.text == closing {
            depth -= 1;
            if depth == 0 {
                return Some(token_index);
            }
        }
    }
    None
}

fn delimiters_are_balanced(tokens: &[GlslToken<'_>]) -> bool {
    let mut delimiters = Vec::new();
    for token in tokens {
        match token.text {
            "(" | "[" | "{" => delimiters.push(token.text),
            ")" if delimiters.pop() != Some("(") => return false,
            "]" if delimiters.pop() != Some("[") => return false,
            "}" if delimiters.pop() != Some("{") => return false,
            _ => {}
        }
    }
    delimiters.is_empty()
}

fn has_glsl_directive(source: &str, directive_names: &[&str]) -> bool {
    source
        .lines()
        .any(|line| line_has_glsl_directive(line.as_bytes(), directive_names))
}

fn line_has_glsl_directive(line: &[u8], directive_names: &[&str]) -> bool {
    let mut offset = skip_horizontal_whitespace(line, 0);
    if line.get(offset) != Some(&b'#') {
        return false;
    }
    offset = skip_horizontal_whitespace(line, offset + 1);
    directive_names.iter().any(|directive_name| {
        let mut candidate_offset = offset;
        consume_word(line, &mut candidate_offset, directive_name)
    })
}

fn consume_word(bytes: &[u8], offset: &mut usize, word: &str) -> bool {
    let word_bytes = word.as_bytes();
    if bytes.get(*offset..*offset + word_bytes.len()) != Some(word_bytes)
        || bytes
            .get(*offset + word_bytes.len())
            .is_some_and(|byte| is_identifier_byte(*byte))
    {
        return false;
    }
    *offset += word_bytes.len();
    true
}

fn skip_horizontal_whitespace(bytes: &[u8], mut offset: usize) -> usize {
    while matches!(bytes.get(offset), Some(b' ' | b'\t')) {
        offset += 1;
    }
    offset
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
