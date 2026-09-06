use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, Expression, ObjectPropertyKind, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const LEGACY_FRAGMENT_OUTPUT_NAMES: [&str; 2] = ["gl_FragColor", "gl_FragData"];
const LEGACY_TEXTURE_FUNCTION_NAMES: [&str; 9] = [
    "texture2D",
    "texture2DGradEXT",
    "texture2DLodEXT",
    "texture2DProj",
    "texture2DProjGradEXT",
    "texture2DProjLodEXT",
    "textureCube",
    "textureCubeGradEXT",
    "textureCubeLodEXT",
];
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
pub struct ThreeShaderNoGlsl1SyntaxWithGlsl3;

declare_oxc_lint!(
    /// Disallow GLSL 1-only syntax in GLSL 3 Three.js shaders.
    ThreeShaderNoGlsl1SyntaxWithGlsl3,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "GLSL 3 shader uses an unavailable GLSL 1 symbol.",
);

impl Rule for ThreeShaderNoGlsl1SyntaxWithGlsl3 {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::NewExpression(new_expression) = node.kind() else {
                continue;
            };
            let is_raw_shader_material = if module_api_reference_matches(
                &new_expression.callee,
                "RawShaderMaterial",
                &THREE_MODULE_SOURCES,
                &property_write_analysis,
                ctx,
            ) {
                true
            } else if module_api_reference_matches(
                &new_expression.callee,
                "ShaderMaterial",
                &THREE_MODULE_SOURCES,
                &property_write_analysis,
                ctx,
            ) {
                false
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
            let Some(shader_expressions) = effective_shader_expressions(options_object) else {
                continue;
            };
            let Some(glsl_version) = shader_expressions.glsl_version else {
                continue;
            };
            if !is_three_glsl3(glsl_version, &property_write_analysis, ctx) {
                continue;
            }
            for (stage, shader_expression) in [
                ("vertex", shader_expressions.vertex_shader),
                ("fragment", shader_expressions.fragment_shader),
            ] {
                let Some(shader_expression) = shader_expression else {
                    continue;
                };
                let Some(shader_source) =
                    resolve_static_shader_text(shader_expression, ctx, &mut FxHashSet::default())
                else {
                    continue;
                };
                let Some(legacy_syntax) = legacy_glsl1_syntax(
                    &shader_source,
                    stage == "fragment",
                    is_raw_shader_material,
                ) else {
                    continue;
                };
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "This GLSL 3 {stage} shader uses {legacy_syntax}, which Three.js does not provide in this material configuration"
                    ))
                    .with_label(shader_expression.span()),
                );
            }
        }
    }
}

struct EffectiveShaderExpressions<'a> {
    fragment_shader: Option<&'a Expression<'a>>,
    glsl_version: Option<&'a Expression<'a>>,
    vertex_shader: Option<&'a Expression<'a>>,
}

fn is_three_glsl3<'a>(
    expression: &Expression<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    matches!(expression, Expression::StringLiteral(literal) if literal.value == "300 es")
        || module_api_reference_matches(
            expression,
            "GLSL3",
            &THREE_MODULE_SOURCES,
            property_write_analysis,
            ctx,
        )
}

fn resolve_stable_shader_options_object<'a>(
    expression: &'a Expression<'a>,
    reference_node: &crate::AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let Expression::ObjectExpression(object_expression) = expression {
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
) -> Option<EffectiveShaderExpressions<'a>> {
    let mut unresolved_property_names =
        FxHashSet::from_iter(STATIC_SHADER_MATERIAL_PROPERTY_NAMES.iter().copied());
    let mut shader_expressions = EffectiveShaderExpressions {
        fragment_shader: None,
        glsl_version: None,
        vertex_shader: None,
    };
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
            "fragmentShader" => shader_expressions.fragment_shader = Some(&property.value),
            "glslVersion" => shader_expressions.glsl_version = Some(&property.value),
            "vertexShader" => shader_expressions.vertex_shader = Some(&property.value),
            _ => {}
        }
    }
    Some(shader_expressions)
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

fn resolve_static_shader_text<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(text) = static_shader_string(expression) {
        return Some(text.to_string());
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
        return resolve_static_shader_text(declarator.init.as_ref()?, ctx, visited_symbol_ids);
    }
    if let Expression::BinaryExpression(binary) = expression
        && binary.operator == oxc_syntax::operator::BinaryOperator::Addition
    {
        let left = resolve_static_shader_text(&binary.left, ctx, &mut visited_symbol_ids.clone())?;
        let right =
            resolve_static_shader_text(&binary.right, ctx, &mut visited_symbol_ids.clone())?;
        return Some(left + &right);
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
        resolve_static_shader_text(
            argument.as_expression()?,
            ctx,
            &mut visited_symbol_ids.clone(),
        )?
    } else {
        ",".to_string()
    };
    let mut elements = Vec::with_capacity(array_expression.elements.len());
    for element in &array_expression.elements {
        let element = match element {
            ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_) => {
                return None;
            }
            element => element.as_expression()?,
        };
        elements.push(resolve_static_shader_text(
            element,
            ctx,
            &mut visited_symbol_ids.clone(),
        )?);
    }
    Some(elements.join(&separator))
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

fn legacy_glsl1_syntax(
    source: &str,
    is_fragment_shader: bool,
    is_raw_shader_material: bool,
) -> Option<String> {
    let source_without_comments = mask_glsl_comments(source)?;
    if has_conditional_glsl_directive(&source_without_comments) {
        return None;
    }
    let parsed_source = mask_glsl_preprocessor_directives(source_without_comments.clone())?;
    if parsed_source.contains('#') || !glsl_delimiters_are_balanced(&parsed_source) {
        return None;
    }
    if is_raw_shader_material && let Some(qualifier) = first_legacy_global_qualifier(&parsed_source)
    {
        return Some(qualifier.to_string());
    }
    let suppressed_texture_functions: FxHashSet<&str> = if is_raw_shader_material {
        FxHashSet::from_iter(LEGACY_TEXTURE_FUNCTION_NAMES.iter().copied().filter(
            |function_name| {
                has_glsl_function_like_macro(&source_without_comments, function_name)
                    || has_glsl_function_declaration(&parsed_source, function_name)
            },
        ))
    } else {
        FxHashSet::default()
    };
    let suppressed_fragment_outputs: FxHashSet<&str> = if is_fragment_shader {
        FxHashSet::from_iter(
            LEGACY_FRAGMENT_OUTPUT_NAMES
                .iter()
                .copied()
                .filter(|output_name| has_glsl_define(&source_without_comments, output_name)),
        )
    } else {
        FxHashSet::default()
    };
    let bytes = parsed_source.as_bytes();
    let mut byte_offset = 0;
    while byte_offset < bytes.len() {
        if !is_identifier_start_byte(bytes[byte_offset]) {
            byte_offset += 1;
            continue;
        }
        let identifier_start = byte_offset;
        byte_offset += 1;
        while bytes
            .get(byte_offset)
            .is_some_and(|byte| is_identifier_byte(*byte))
        {
            byte_offset += 1;
        }
        let identifier = &parsed_source[identifier_start..byte_offset];
        if is_fragment_shader
            && LEGACY_FRAGMENT_OUTPUT_NAMES.contains(&identifier)
            && !suppressed_fragment_outputs.contains(identifier)
        {
            return Some(identifier.to_string());
        }
        if is_raw_shader_material
            && LEGACY_TEXTURE_FUNCTION_NAMES.contains(&identifier)
            && !suppressed_texture_functions.contains(identifier)
            && previous_non_whitespace_byte(bytes, identifier_start) != Some(b'.')
            && bytes.get(skip_ascii_whitespace(bytes, byte_offset)) == Some(&b'(')
        {
            return Some(identifier.to_string());
        }
    }
    None
}

fn first_legacy_global_qualifier(source: &str) -> Option<&'static str> {
    let tokens = tokenize_glsl(source)?;
    let mut statement_start = 0;
    let mut brace_depth = 0usize;
    let mut is_struct_declaration_brace = false;
    for (token_index, token) in tokens.iter().enumerate() {
        match token.text {
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
                if let Some(qualifier) =
                    legacy_declaration_qualifier(&tokens[statement_start..token_index])
                {
                    return Some(qualifier);
                }
                statement_start = token_index + 1;
            }
            _ => {}
        }
    }
    (brace_depth == 0).then_some(())?;
    None
}

fn legacy_declaration_qualifier(tokens: &[GlslToken<'_>]) -> Option<&'static str> {
    let mut token_index = 0;
    while matches!(
        tokens.get(token_index).map(|token| token.text),
        Some("layout" | "subroutine")
    ) && tokens.get(token_index + 1).map(|token| token.text) == Some("(")
    {
        token_index = matching_token(tokens, token_index + 1, "(", ")")? + 1;
    }
    let mut has_attribute = false;
    let mut has_varying = false;
    while tokens
        .get(token_index)
        .is_some_and(|token| is_glsl_qualifier(token.text))
    {
        has_attribute |= tokens[token_index].text == "attribute";
        has_varying |= tokens[token_index].text == "varying";
        token_index += 1;
    }
    if !has_attribute && !has_varying {
        return None;
    }
    if tokens.get(token_index).map(|token| token.text) == Some("struct") {
        token_index += 1;
        if tokens
            .get(token_index)
            .is_none_or(|token| !is_identifier_token(token.text))
        {
            return None;
        }
        token_index += 1;
        if tokens.get(token_index).map(|token| token.text) == Some("{") {
            token_index = matching_token(tokens, token_index, "{", "}")? + 1;
        }
    } else {
        token_index += 1;
    }
    while tokens.get(token_index).map(|token| token.text) == Some("[") {
        token_index = matching_token(tokens, token_index, "[", "]")? + 1;
    }
    let name = tokens.get(token_index)?;
    if !is_identifier_token(name.text)
        || tokens.get(token_index + 1).map(|token| token.text) == Some("(")
    {
        return None;
    }
    if has_attribute {
        Some("attribute")
    } else {
        Some("varying")
    }
}

#[derive(Clone, Copy)]
struct GlslToken<'a> {
    text: &'a str,
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
        if is_identifier_start_byte(bytes[byte_offset]) {
            byte_offset += 1;
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
        } else if bytes[byte_offset].is_ascii() && !matches!(bytes[byte_offset], b'"' | b'\'') {
            byte_offset += 1;
        } else {
            return None;
        }
        tokens.push(GlslToken {
            text: &source[token_start..byte_offset],
        });
    }
    Some(tokens)
}

fn matching_token(
    tokens: &[GlslToken<'_>],
    opening_index: usize,
    opening: &str,
    closing: &str,
) -> Option<usize> {
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

fn is_glsl_qualifier(token: &str) -> bool {
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

fn is_identifier_token(token: &str) -> bool {
    token
        .as_bytes()
        .first()
        .is_some_and(|byte| is_identifier_start_byte(*byte))
        && token.bytes().all(is_identifier_byte)
}

fn has_glsl_function_like_macro(source: &str, function_name: &str) -> bool {
    source
        .split(|character| matches!(character, '\r' | '\n'))
        .any(|line| {
            let bytes = line.as_bytes();
            let mut offset = skip_horizontal_whitespace(bytes, 0);
            if bytes.get(offset) != Some(&b'#') {
                return false;
            }
            offset = skip_horizontal_whitespace(bytes, offset + 1);
            if !consume_word(bytes, &mut offset, "define")
                || !matches!(bytes.get(offset), Some(b' ' | b'\t'))
            {
                return false;
            }
            offset = skip_horizontal_whitespace(bytes, offset);
            if !consume_word(bytes, &mut offset, function_name) {
                return false;
            }
            bytes
                .get(offset)
                .is_some_and(|byte| matches!(byte, b' ' | b'\t' | b'('))
        })
}

fn has_glsl_define(source: &str, identifier: &str) -> bool {
    source
        .split(|character| matches!(character, '\r' | '\n'))
        .any(|line| {
            let bytes = line.as_bytes();
            let mut offset = skip_horizontal_whitespace(bytes, 0);
            if bytes.get(offset) != Some(&b'#') {
                return false;
            }
            offset = skip_horizontal_whitespace(bytes, offset + 1);
            if !consume_word(bytes, &mut offset, "define")
                || !matches!(bytes.get(offset), Some(b' ' | b'\t'))
            {
                return false;
            }
            offset = skip_horizontal_whitespace(bytes, offset);
            consume_word(bytes, &mut offset, identifier)
        })
}

fn has_glsl_function_declaration(source: &str, function_name: &str) -> bool {
    let bytes = source.as_bytes();
    let mut search_offset = 0;
    while search_offset + function_name.len() <= bytes.len() {
        let Some(relative_offset) = source[search_offset..].find(function_name) else {
            return false;
        };
        let name_offset = search_offset + relative_offset;
        search_offset = name_offset + function_name.len();
        if !is_identifier_boundary(bytes.get(name_offset.wrapping_sub(1)).copied())
            || !is_identifier_boundary(bytes.get(search_offset).copied())
            || previous_non_whitespace_byte(bytes, name_offset) == Some(b'.')
        {
            continue;
        }
        let opening_parenthesis = skip_ascii_whitespace(bytes, search_offset);
        if bytes.get(opening_parenthesis) != Some(&b'(') {
            continue;
        }
        let Some(closing_parenthesis) = matching_closing_parenthesis(bytes, opening_parenthesis)
        else {
            continue;
        };
        let following_offset = skip_ascii_whitespace(bytes, closing_parenthesis + 1);
        if !matches!(bytes.get(following_offset), Some(b'{' | b';')) {
            continue;
        }
        let prefix_start = bytes[..name_offset]
            .iter()
            .rposition(|byte| matches!(byte, b';' | b'{' | b'}'))
            .map_or(0, |offset| offset + 1);
        let prefix = source[prefix_start..name_offset].trim_ascii();
        if prefix.is_empty()
            || prefix == "return"
            || prefix.bytes().any(|byte| {
                matches!(
                    byte,
                    b'=' | b'+' | b'-' | b'*' | b'/' | b'%' | b'!' | b'?' | b'&' | b'|' | b'.'
                )
            })
        {
            continue;
        }
        if prefix
            .split_ascii_whitespace()
            .last()
            .is_some_and(|token| token.bytes().all(is_identifier_byte))
        {
            return true;
        }
    }
    false
}

fn mask_glsl_comments(source: &str) -> Option<String> {
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
    String::from_utf8(bytes).ok()
}

fn has_conditional_glsl_directive(source: &str) -> bool {
    source
        .split(|character| matches!(character, '\r' | '\n'))
        .any(|line| {
            line_has_glsl_directive(
                line.as_bytes(),
                &["if", "ifdef", "ifndef", "elif", "else", "endif"],
            )
        })
}

fn mask_glsl_preprocessor_directives(source: String) -> Option<String> {
    let mut bytes = source.into_bytes();
    let mut line_start = 0;
    let mut is_directive_continuation = false;
    while line_start <= bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|byte| matches!(byte, b'\r' | b'\n'))
            .map_or(bytes.len(), |offset| line_start + offset);
        let line = &bytes[line_start..line_end];
        let is_directive_line = is_directive_continuation
            || line.iter().find(|byte| !matches!(byte, b' ' | b'\t')) == Some(&b'#');
        is_directive_continuation = is_directive_line
            && line.iter().rfind(|byte| !matches!(byte, b' ' | b'\t')) == Some(&b'\\');
        if is_directive_line {
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
    String::from_utf8(bytes).ok()
}

fn glsl_delimiters_are_balanced(source: &str) -> bool {
    let mut delimiters = Vec::new();
    for byte in source.bytes() {
        match byte {
            b'(' | b'[' | b'{' => delimiters.push(byte),
            b')' if delimiters.pop() != Some(b'(') => return false,
            b']' if delimiters.pop() != Some(b'[') => return false,
            b'}' if delimiters.pop() != Some(b'{') => return false,
            _ => {}
        }
    }
    delimiters.is_empty()
}

fn matching_closing_parenthesis(bytes: &[u8], opening_parenthesis: usize) -> Option<usize> {
    let mut depth = 0;
    for (offset, byte) in bytes.iter().copied().enumerate().skip(opening_parenthesis) {
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(offset);
                }
            }
            _ => {}
        }
    }
    None
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

fn previous_non_whitespace_byte(bytes: &[u8], offset: usize) -> Option<u8> {
    bytes[..offset]
        .iter()
        .rev()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
}

fn skip_ascii_whitespace(bytes: &[u8], mut offset: usize) -> usize {
    while bytes.get(offset).is_some_and(u8::is_ascii_whitespace) {
        offset += 1;
    }
    offset
}

fn skip_horizontal_whitespace(bytes: &[u8], mut offset: usize) -> usize {
    while matches!(bytes.get(offset), Some(b' ' | b'\t')) {
        offset += 1;
    }
    offset
}

fn is_identifier_boundary(byte: Option<u8>) -> bool {
    byte.is_none_or(|byte| !is_identifier_byte(byte))
}

fn is_identifier_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
