use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, Expression, ObjectPropertyKind, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule};

const PRECISION_QUALIFIER_NAMES: [&str; 3] = ["highp", "mediump", "lowp"];
const SHADER_MATERIAL_CONSTRUCTOR_NAMES: [&str; 2] = ["RawShaderMaterial", "ShaderMaterial"];
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
const THREE_MODULE_SOURCES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeShaderRequireMatchingUniforms;

declare_oxc_lint!(
    /// Require compatible uniforms across shader stages.
    ThreeShaderRequireMatchingUniforms,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader stages declare incompatible uniforms.",
);

impl Rule for ThreeShaderRequireMatchingUniforms {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for_each_static_matching_shader_material(
            ctx,
            |_vertex_shader, fragment_shader, vertex_declarations, fragment_declarations, ctx| {
                let vertex_uniforms = vertex_declarations
                    .iter()
                    .filter(|declaration| {
                        declaration.qualifiers.contains("uniform") && declaration.is_statically_used
                    })
                    .map(|declaration| (declaration.name.as_str(), declaration))
                    .collect::<FxHashMap<_, _>>();
                let mut fragment_uniform_names = Vec::new();
                let mut fragment_uniforms = FxHashMap::default();
                for fragment_uniform in fragment_declarations.iter().filter(|declaration| {
                    declaration.qualifiers.contains("uniform") && declaration.is_statically_used
                }) {
                    let uniform_name = fragment_uniform.name.as_str();
                    if !fragment_uniforms.contains_key(uniform_name) {
                        fragment_uniform_names.push(uniform_name);
                    }
                    fragment_uniforms.insert(uniform_name, fragment_uniform);
                }
                for uniform_name in fragment_uniform_names {
                    let fragment_uniform = fragment_uniforms[uniform_name];
                    let Some(vertex_uniform) = vertex_uniforms.get(uniform_name) else {
                        continue;
                    };
                    let mismatch = if vertex_uniform.type_name != fragment_uniform.type_name {
                        Some(format!(
                            "type {} in the vertex shader and {} in the fragment shader",
                            vertex_uniform.type_name, fragment_uniform.type_name
                        ))
                    } else if has_array_dimension_mismatch(
                        vertex_uniform.array_size,
                        fragment_uniform.array_size,
                    ) {
                        Some("different array dimensions".to_string())
                    } else {
                        let vertex_precision = declaration_precision(vertex_uniform);
                        let fragment_precision = declaration_precision(fragment_uniform);
                        match (vertex_precision, fragment_precision) {
                            (Some(vertex_precision), Some(fragment_precision))
                                if vertex_precision != fragment_precision =>
                            {
                                Some(format!(
                                    "precision {vertex_precision} in the vertex shader and {fragment_precision} in the fragment shader"
                                ))
                            }
                            _ => None,
                        }
                    };
                    let Some(mismatch) = mismatch else {
                        continue;
                    };
                    let utf16_offset = fragment_shader.text[..fragment_uniform.byte_offset]
                        .encode_utf16()
                        .count();
                    ctx.diagnostic(
                        OxcDiagnostic::error(format!(
                            "Uniform {uniform_name} has {mismatch}, so the shader stages cannot link consistently"
                        ))
                        .with_label(fragment_shader.origin_span(utf16_offset)),
                    );
                }
            },
        );
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum GlslArraySize {
    NonArray,
    Unknown,
    Known(f64),
}

pub(super) struct GlslGlobalDeclaration {
    pub(super) array_size: GlslArraySize,
    pub(super) byte_offset: usize,
    pub(super) has_layout_qualifier: bool,
    pub(super) interpolation: String,
    pub(super) is_statically_used: bool,
    pub(super) name: String,
    pub(super) qualifiers: FxHashSet<String>,
    pub(super) type_name: String,
}

pub(super) struct StaticShaderSourceSegment {
    start_offset: usize,
    end_offset: usize,
    span: Span,
}

pub(super) struct StaticShaderSource {
    pub(super) text: String,
    segments: Vec<StaticShaderSourceSegment>,
    fallback_span: Span,
}

impl StaticShaderSource {
    pub(super) fn origin_span(&self, offset: usize) -> Span {
        self.segments
            .iter()
            .find(|segment| offset >= segment.start_offset && offset < segment.end_offset)
            .map_or(self.fallback_span, |segment| segment.span)
    }
}

pub(super) fn for_each_static_matching_shader_material<'a>(
    ctx: &LintContext<'a>,
    mut callback: impl FnMut(
        &StaticShaderSource,
        &StaticShaderSource,
        &[GlslGlobalDeclaration],
        &[GlslGlobalDeclaration],
        &LintContext<'a>,
    ),
) {
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
        let Some((vertex_shader_expression, fragment_shader_expression)) =
            effective_shader_expressions(options_object)
        else {
            continue;
        };
        let (Some(vertex_shader_expression), Some(fragment_shader_expression)) =
            (vertex_shader_expression, fragment_shader_expression)
        else {
            continue;
        };
        let Some(vertex_shader) =
            resolve_static_shader_source(vertex_shader_expression, ctx, &mut FxHashSet::default())
        else {
            continue;
        };
        let Some(fragment_shader) = resolve_static_shader_source(
            fragment_shader_expression,
            ctx,
            &mut FxHashSet::default(),
        ) else {
            continue;
        };
        let Some(vertex_declarations) = collect_glsl_global_declarations(&vertex_shader.text)
        else {
            continue;
        };
        let Some(fragment_declarations) = collect_glsl_global_declarations(&fragment_shader.text)
        else {
            continue;
        };
        callback(
            &vertex_shader,
            &fragment_shader,
            &vertex_declarations,
            &fragment_declarations,
            ctx,
        );
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

fn effective_shader_expressions<'a>(
    options: &'a oxc_ast::ast::ObjectExpression<'a>,
) -> Option<(Option<&'a Expression<'a>>, Option<&'a Expression<'a>>)> {
    let mut unresolved_property_names =
        FxHashSet::from_iter(STATIC_SHADER_MATERIAL_PROPERTY_NAMES.iter().copied());
    let mut fragment_shader = None;
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
            "vertexShader" => vertex_shader = Some(&property.value),
            _ => {}
        }
    }
    Some((vertex_shader, fragment_shader))
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

pub(super) fn collect_glsl_global_declarations(source: &str) -> Option<Vec<GlslGlobalDeclaration>> {
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
    let mut is_struct_declaration_brace = false;
    let mut statement_start = 0;
    for token_index in 0..tokens.len() {
        match tokens[token_index].text {
            "{" => {
                if brace_depth == 0 {
                    is_struct_declaration_brace = tokens[statement_start..token_index]
                        .iter()
                        .any(|token| token.text == "struct");
                }
                brace_depth += 1;
            }
            "}" => {
                brace_depth = brace_depth.checked_sub(1)?;
                if brace_depth == 0 && !is_struct_declaration_brace {
                    statement_start = token_index + 1;
                }
                if brace_depth == 0 {
                    is_struct_declaration_brace = false;
                }
            }
            ";" if brace_depth == 0 => {
                collect_declarations_from_statement(
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
    if brace_depth != 0 || statement_start != tokens.len() {
        return None;
    }
    let declaration_offsets = declarations
        .iter()
        .map(|declaration| declaration.byte_offset)
        .collect::<FxHashSet<_>>();
    for declaration in &mut declarations {
        declaration.is_statically_used = tokens.iter().any(|token| {
            token.kind == GlslTokenKind::Identifier
                && token.text == declaration.name
                && !declaration_offsets.contains(&token.start)
                && previous_token_text(&tokens, token.start) != Some(".")
                && !identifier_is_declaration_name(&tokens, token.start)
                && !local_binding_shadows_identifier(&token_source, &declaration.name, token.start)
        });
    }
    Some(declarations)
}

fn collect_declarations_from_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    declarations: &mut Vec<GlslGlobalDeclaration>,
) -> Option<()> {
    if start >= end {
        return Some(());
    }
    let mut token_index = start;
    let mut has_layout_qualifier = false;
    let mut qualifiers = FxHashSet::default();
    while token_index < end {
        if matches!(tokens[token_index].text, "layout" | "subroutine")
            && tokens.get(token_index + 1).map(|token| token.text) == Some("(")
        {
            has_layout_qualifier |= tokens[token_index].text == "layout";
            token_index = matching_token(tokens, token_index + 1, "(", ")")? + 1;
            continue;
        }
        if !is_glsl_declaration_qualifier(tokens[token_index].text) {
            break;
        }
        qualifiers.insert(tokens[token_index].text.to_string());
        token_index += 1;
    }
    let Some(type_token) = tokens.get(token_index) else {
        return Some(());
    };
    if type_token.kind != GlslTokenKind::Identifier
        || matches!(type_token.text, "precision" | "struct")
    {
        return Some(());
    }
    token_index += 1;
    let (type_quantifier_count, type_array_size) =
        parse_array_quantifiers(tokens, &mut token_index)?;
    let interpolation = interpolation_qualifier(&qualifiers);
    let mut declaration_index = 0;
    while token_index < end {
        let name_token = tokens[token_index];
        if name_token.kind != GlslTokenKind::Identifier {
            return Some(());
        }
        token_index += 1;
        if tokens.get(token_index).map(|token| token.text) == Some("(") {
            return Some(());
        }
        let (declaration_quantifier_count, declaration_array_size) =
            parse_array_quantifiers(tokens, &mut token_index)?;
        let total_quantifier_count = type_quantifier_count + declaration_quantifier_count;
        let array_size = match total_quantifier_count {
            0 => GlslArraySize::NonArray,
            1 => type_array_size
                .or(declaration_array_size)
                .map_or(GlslArraySize::Unknown, GlslArraySize::Known),
            _ => GlslArraySize::Unknown,
        };
        declarations.push(GlslGlobalDeclaration {
            array_size,
            byte_offset: if declaration_index == 0 {
                tokens[start].start
            } else {
                name_token.start
            },
            has_layout_qualifier,
            interpolation: interpolation.clone(),
            is_statically_used: false,
            name: name_token.text.to_string(),
            qualifiers: qualifiers.clone(),
            type_name: type_token.text.to_string(),
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

fn parse_array_quantifiers(
    tokens: &[GlslToken<'_>],
    token_index: &mut usize,
) -> Option<(usize, Option<f64>)> {
    let mut quantifier_count = 0;
    let mut size = None;
    while tokens.get(*token_index).map(|token| token.text) == Some("[") {
        let opening_index = *token_index;
        let closing_index = matching_token(tokens, opening_index, "[", "]")?;
        quantifier_count += 1;
        if quantifier_count == 1 {
            let size_source = tokens[opening_index + 1..closing_index]
                .iter()
                .map(|token| token.text)
                .collect::<String>();
            size = glsl_numeric_constant(&size_source);
        }
        *token_index = closing_index + 1;
    }
    Some((quantifier_count, size))
}

pub(super) fn has_array_dimension_mismatch(first: GlslArraySize, second: GlslArraySize) -> bool {
    matches!(first, GlslArraySize::NonArray) != matches!(second, GlslArraySize::NonArray)
        || matches!((first, second), (GlslArraySize::Known(first), GlslArraySize::Known(second)) if first != second)
}

fn declaration_precision(declaration: &GlslGlobalDeclaration) -> Option<&'static str> {
    PRECISION_QUALIFIER_NAMES
        .iter()
        .copied()
        .find(|precision| declaration.qualifiers.contains(*precision))
}

fn interpolation_qualifier(qualifiers: &FxHashSet<String>) -> String {
    let mut interpolation = qualifiers
        .iter()
        .filter(|qualifier| {
            matches!(
                qualifier.as_str(),
                "centroid" | "flat" | "noperspective" | "sample" | "smooth"
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    if !interpolation
        .iter()
        .any(|qualifier| matches!(qualifier.as_str(), "flat" | "noperspective" | "smooth"))
    {
        interpolation.push("smooth".to_string());
    }
    interpolation.sort_unstable();
    interpolation.join(" ")
}

fn previous_token_text<'a>(tokens: &'a [GlslToken<'a>], byte_offset: usize) -> Option<&'a str> {
    tokens
        .iter()
        .rev()
        .find(|token| token.start < byte_offset)
        .map(|token| token.text)
}

fn identifier_is_declaration_name(tokens: &[GlslToken<'_>], byte_offset: usize) -> bool {
    let Some(token_index) = tokens.iter().position(|token| token.start == byte_offset) else {
        return false;
    };
    if token_index == 0 {
        return false;
    }
    let mut previous_index = token_index - 1;
    while previous_index > 0 && is_glsl_declaration_qualifier(tokens[previous_index].text) {
        previous_index -= 1;
    }
    tokens[previous_index].kind == GlslTokenKind::Identifier
        && !matches!(
            tokens[previous_index].text,
            "return" | "case" | "else" | "break" | "continue"
        )
        && (previous_index == 0
            || matches!(tokens[previous_index - 1].text, ";" | "{" | "}" | "(" | ",")
            || is_glsl_declaration_qualifier(tokens[previous_index - 1].text))
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
        source[block_start..use_offset]
            .split(';')
            .any(|statement| statement_declares_name(statement, name))
            || block_header_declares_name(source, block_start - 1, name)
    })
}

fn block_header_declares_name(source: &str, opening_brace: usize, name: &str) -> bool {
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
    source[opening_parenthesis + 1..closing_parenthesis]
        .split(',')
        .any(|parameter| statement_declares_name(parameter, name))
}

fn statement_declares_name(statement: &str, name: &str) -> bool {
    let tokens = tokenize_glsl(statement).unwrap_or_default();
    tokens.iter().enumerate().any(|(token_index, token)| {
        token.kind == GlslTokenKind::Identifier
            && token.text == name
            && token_index > 0
            && tokens[token_index - 1].kind == GlslTokenKind::Identifier
            && !matches!(tokens[token_index - 1].text, "return" | "case" | "else")
    })
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
            | "buffer"
            | "centroid"
            | "coherent"
            | "flat"
            | "highp"
            | "in"
            | "inout"
            | "invariant"
            | "lowp"
            | "mediump"
            | "noperspective"
            | "out"
            | "patch"
            | "precise"
            | "readonly"
            | "restrict"
            | "sample"
            | "shared"
            | "smooth"
            | "uniform"
            | "varying"
            | "volatile"
            | "writeonly"
    )
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
        let kind = if is_identifier_start_byte(bytes[byte_offset]) {
            byte_offset += 1;
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
            GlslTokenKind::Identifier
        } else if is_glsl_symbol_byte(bytes[byte_offset]) {
            byte_offset += 1;
            GlslTokenKind::Symbol
        } else {
            return None;
        };
        tokens.push(GlslToken {
            kind,
            start: token_start,
            text: &source[token_start..byte_offset],
        });
    }
    delimiters_are_balanced(&tokens).then_some(tokens)
}

fn is_glsl_symbol_byte(byte: u8) -> bool {
    byte.is_ascii_digit()
        || matches!(
            byte,
            b'(' | b')'
                | b'['
                | b']'
                | b'{'
                | b'}'
                | b','
                | b';'
                | b':'
                | b'.'
                | b'?'
                | b'~'
                | b'!'
                | b'+'
                | b'-'
                | b'*'
                | b'/'
                | b'%'
                | b'<'
                | b'>'
                | b'='
                | b'&'
                | b'^'
                | b'|'
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

fn glsl_numeric_constant(source: &str) -> Option<f64> {
    let candidate = source.trim_ascii();
    let value = if candidate.starts_with('(')
        && matching_closing_delimiter(candidate.as_bytes(), 0, b'(', b')')
            == Some(candidate.len().checked_sub(1)?)
    {
        glsl_numeric_constant(&candidate[1..candidate.len() - 1])?
    } else if let Some(rest) = candidate.strip_prefix('+') {
        glsl_numeric_constant(rest)?
    } else if let Some(rest) = candidate.strip_prefix('-') {
        -glsl_numeric_constant(rest)?
    } else {
        parse_glsl_numeric_token(candidate)?
    };
    value.is_finite().then_some(value)
}

fn parse_glsl_numeric_token(token: &str) -> Option<f64> {
    if token.is_empty() || token.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return None;
    }
    let token = token
        .strip_suffix("LF")
        .or_else(|| token.strip_suffix("lf"))
        .or_else(|| token.strip_suffix('F'))
        .or_else(|| token.strip_suffix('f'))
        .or_else(|| token.strip_suffix('U'))
        .or_else(|| token.strip_suffix('u'))
        .unwrap_or(token);
    if let Some(hexadecimal) = token
        .strip_prefix("0x")
        .or_else(|| token.strip_prefix("0X"))
    {
        return u64::from_str_radix(hexadecimal, 16)
            .ok()
            .map(|value| value as f64);
    }
    token.parse::<f64>().ok()
}

fn matching_closing_delimiter(
    bytes: &[u8],
    opening_offset: usize,
    opening: u8,
    closing: u8,
) -> Option<usize> {
    let mut depth = 0;
    for (offset, byte) in bytes.iter().copied().enumerate().skip(opening_offset) {
        if byte == opening {
            depth += 1;
        } else if byte == closing {
            depth -= 1;
            if depth == 0 {
                return Some(offset);
            }
        }
    }
    None
}

fn matching_opening_delimiter(
    bytes: &[u8],
    closing_offset: usize,
    opening: u8,
    closing: u8,
) -> Option<usize> {
    let mut depth = 0;
    for (offset, byte) in bytes[..=closing_offset].iter().copied().enumerate().rev() {
        if byte == closing {
            depth += 1;
        } else if byte == opening {
            depth -= 1;
            if depth == 0 {
                return Some(offset);
            }
        }
    }
    None
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

fn is_identifier_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
