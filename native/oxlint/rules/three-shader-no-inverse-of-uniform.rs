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
pub struct ThreeShaderNoInverseOfUniform;

declare_oxc_lint!(
    /// Disallow inverting a uniform matrix for every shader invocation.
    ThreeShaderNoInverseOfUniform,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Shader inverts a uniform matrix per invocation.",
);

impl Rule for ThreeShaderNoInverseOfUniform {
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
            let Some((fragment_shader, vertex_shader)) =
                effective_shader_expressions(options_object)
            else {
                continue;
            };
            for shader_expression in [fragment_shader, vertex_shader].into_iter().flatten() {
                let Some(shader_source) =
                    resolve_static_shader_source(shader_expression, ctx, &mut FxHashSet::default())
                else {
                    continue;
                };
                for inverse_call in inverse_uniform_calls(&shader_source.text) {
                    let message = format!(
                        "The matrix {} is uniform across this draw, but inverse recomputes it for every shader invocation. Compute and bind the inverse matrix on the CPU",
                        inverse_call.matrix_name,
                    );
                    let utf16_offset = shader_source.text[..inverse_call.byte_offset]
                        .encode_utf16()
                        .count();
                    ctx.diagnostic(
                        OxcDiagnostic::warn(message)
                            .with_label(shader_source.origin_span(utf16_offset)),
                    );
                }
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

struct InverseUniformCall {
    byte_offset: usize,
    matrix_name: String,
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
        || symbol_has_write_before(symbol_id, reference_node.span().start, ctx)
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
    Some((fragment_shader, vertex_shader))
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

fn inverse_uniform_calls(source: &str) -> Vec<InverseUniformCall> {
    let Some(masked_source) = mask_parseable_glsl_source(source) else {
        return Vec::new();
    };
    if has_glsl_function_like_macro(&masked_source, "inverse")
        || has_glsl_function_declaration(&masked_source, "inverse")
    {
        return Vec::new();
    }
    let code_source = mask_glsl_directive_lines(masked_source);
    let uniform_names = collect_global_uniform_names(&code_source);
    let bytes = code_source.as_bytes();
    let mut calls = Vec::new();
    let mut byte_offset = 0;
    while byte_offset + "inverse".len() <= bytes.len() {
        let Some(relative_offset) = code_source[byte_offset..].find("inverse") else {
            break;
        };
        let call_offset = byte_offset + relative_offset;
        byte_offset = call_offset + "inverse".len();
        if !is_identifier_boundary(bytes.get(call_offset.wrapping_sub(1)).copied())
            || !is_identifier_boundary(bytes.get(byte_offset).copied())
        {
            continue;
        }
        let opening_parenthesis = skip_ascii_whitespace(bytes, byte_offset);
        if bytes.get(opening_parenthesis) != Some(&b'(') {
            continue;
        }
        let Some((argument_ranges, _closing_parenthesis)) =
            glsl_call_argument_ranges(bytes, opening_parenthesis)
        else {
            continue;
        };
        if argument_ranges.len() != 1 {
            continue;
        }
        let argument = code_source[argument_ranges[0].clone()].trim_ascii();
        if argument.is_empty() || !argument.bytes().all(is_identifier_byte) {
            continue;
        }
        if !uniform_names.contains(argument) {
            continue;
        }
        let argument_offset = argument_ranges[0].start
            + code_source[argument_ranges[0].clone()]
                .len()
                .saturating_sub(code_source[argument_ranges[0].clone()].trim_start().len());
        if local_binding_shadows_uniform(&code_source, argument, argument_offset) {
            continue;
        }
        calls.push(InverseUniformCall {
            byte_offset: call_offset,
            matrix_name: argument.to_string(),
        });
    }
    calls
}

fn mask_glsl_directive_lines(source: String) -> String {
    let mut bytes = source.into_bytes();
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

fn collect_global_uniform_names(source: &str) -> std::collections::HashSet<String> {
    let bytes = source.as_bytes();
    let mut uniform_names = std::collections::HashSet::new();
    let mut statement_start = 0;
    let mut brace_depth = 0;
    for (byte_offset, byte) in bytes.iter().copied().enumerate() {
        match byte {
            b'{' => brace_depth += 1,
            b'}' => {
                brace_depth -= 1;
                if brace_depth == 0 {
                    statement_start = byte_offset + 1;
                }
            }
            b';' if brace_depth == 0 => {
                collect_uniform_names_from_statement(
                    &source[statement_start..byte_offset],
                    &mut uniform_names,
                );
                statement_start = byte_offset + 1;
            }
            _ => {}
        }
    }
    uniform_names
}

struct UniformToken<'a> {
    is_identifier: bool,
    text: &'a str,
}

fn collect_uniform_names_from_statement(
    statement: &str,
    uniform_names: &mut std::collections::HashSet<String>,
) {
    let tokens = tokenize_uniform_source(statement);
    let mut token_index = 0;
    while tokens
        .get(token_index)
        .is_some_and(|token| token.text == "layout")
        && tokens
            .get(token_index + 1)
            .is_some_and(|token| token.text == "(")
    {
        token_index += 1;
        let Some(closing_parenthesis) = matching_uniform_token(&tokens, token_index, "(", ")")
        else {
            return;
        };
        token_index = closing_parenthesis + 1;
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
        || !tokens
            .get(token_index)
            .is_some_and(|token| token.is_identifier)
    {
        return;
    }
    token_index += 1;
    skip_uniform_array_suffix(&tokens, &mut token_index);
    while token_index < tokens.len() {
        let Some(name_token) = tokens.get(token_index) else {
            return;
        };
        if !name_token.is_identifier {
            return;
        }
        uniform_names.insert(name_token.text.to_string());
        token_index += 1;
        skip_uniform_array_suffix(&tokens, &mut token_index);
        if tokens
            .get(token_index)
            .is_some_and(|token| token.text == "=")
        {
            token_index = next_top_level_uniform_comma(&tokens, token_index + 1);
        }
        if token_index == tokens.len() {
            return;
        }
        if tokens[token_index].text != "," {
            return;
        }
        token_index += 1;
    }
}

fn tokenize_uniform_source(source: &str) -> Vec<UniformToken<'_>> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut byte_offset = 0;
    while byte_offset < bytes.len() {
        if bytes[byte_offset].is_ascii_whitespace() {
            byte_offset += 1;
            continue;
        }
        let token_start = byte_offset;
        let is_identifier = is_identifier_start_byte(bytes[byte_offset]);
        byte_offset += 1;
        if is_identifier {
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
        }
        tokens.push(UniformToken {
            is_identifier,
            text: &source[token_start..byte_offset],
        });
    }
    tokens
}

fn skip_uniform_array_suffix(tokens: &[UniformToken<'_>], token_index: &mut usize) {
    while tokens
        .get(*token_index)
        .is_some_and(|token| token.text == "[")
    {
        let Some(closing_bracket) = matching_uniform_token(tokens, *token_index, "[", "]") else {
            return;
        };
        *token_index = closing_bracket + 1;
    }
}

fn matching_uniform_token(
    tokens: &[UniformToken<'_>],
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

fn next_top_level_uniform_comma(tokens: &[UniformToken<'_>], start: usize) -> usize {
    let mut delimiters = Vec::new();
    for (token_index, token) in tokens.iter().enumerate().skip(start) {
        match token.text {
            "(" | "[" | "{" => delimiters.push(token.text),
            ")" if delimiters.pop() != Some("(") => return tokens.len(),
            "]" if delimiters.pop() != Some("[") => return tokens.len(),
            "}" if delimiters.pop() != Some("{") => return tokens.len(),
            "," if delimiters.is_empty() => return token_index,
            _ => {}
        }
    }
    tokens.len()
}

fn local_binding_shadows_uniform(source: &str, name: &str, use_offset: usize) -> bool {
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
        uniform_tokens_declare_name(
            &tokenize_uniform_source(&source[block_start..use_offset]),
            name,
        ) || uniform_block_header_declares_name(source, block_start - 1, name)
    })
}

fn uniform_block_header_declares_name(source: &str, opening_brace: usize, name: &str) -> bool {
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
    let Some(opening_parenthesis) = matching_opening_parenthesis(bytes, closing_parenthesis) else {
        return false;
    };
    uniform_tokens_declare_name(
        &tokenize_uniform_source(&source[opening_parenthesis + 1..closing_parenthesis]),
        name,
    )
}

fn uniform_tokens_declare_name(tokens: &[UniformToken<'_>], name: &str) -> bool {
    tokens.iter().enumerate().any(|(token_index, token)| {
        if !token.is_identifier || token.text != name || token_index == 0 {
            return false;
        }
        let type_token = &tokens[token_index - 1];
        type_token.is_identifier
            && !matches!(type_token.text, "return" | "case" | "else")
            && (token_index == 1
                || matches!(tokens[token_index - 2].text, ";" | "{" | "}" | "(" | ",")
                || is_glsl_declaration_qualifier(tokens[token_index - 2].text))
    })
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

fn mask_parseable_glsl_source(source: &str) -> Option<String> {
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
    let mut line_start = 0;
    while line_start <= bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|byte| matches!(byte, b'\r' | b'\n'))
            .map_or(bytes.len(), |offset| line_start + offset);
        let line = &bytes[line_start..line_end];
        if line_has_glsl_directive(line, &["if", "ifdef", "ifndef", "elif", "else", "endif"]) {
            return None;
        }
        if is_three_include_directive(line) {
            bytes[line_start..line_end].fill(b' ');
        }
        if line_end == bytes.len() {
            break;
        }
        line_start = line_end + 1;
    }
    let masked_source = String::from_utf8(bytes).ok()?;
    glsl_delimiters_are_balanced(&masked_source).then_some(masked_source)
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
        && source
            .bytes()
            .any(|byte| matches!(byte, b';' | b'{' | b'}'))
}

fn has_glsl_function_like_macro(source: &str, function_name: &str) -> bool {
    source.lines().any(|line| {
        let bytes = line.as_bytes();
        let mut offset = skip_horizontal_whitespace(bytes, 0);
        if bytes.get(offset) != Some(&b'#') {
            return false;
        }
        offset = skip_horizontal_whitespace(bytes, offset + 1);
        if !consume_word(bytes, &mut offset, "define") {
            return false;
        }
        if !matches!(bytes.get(offset), Some(b' ' | b'\t')) {
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
        {
            continue;
        }
        let opening_parenthesis = skip_ascii_whitespace(bytes, search_offset);
        if bytes.get(opening_parenthesis) != Some(&b'(') {
            continue;
        }
        let Some((_, closing_parenthesis)) = glsl_call_argument_ranges(bytes, opening_parenthesis)
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
        let prefix = source[prefix_start..name_offset].trim();
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

fn glsl_call_argument_ranges(
    bytes: &[u8],
    opening_parenthesis: usize,
) -> Option<(Vec<std::ops::Range<usize>>, usize)> {
    let mut arguments = Vec::new();
    let mut argument_start = opening_parenthesis + 1;
    let mut delimiters = vec![b'('];
    let mut offset = opening_parenthesis + 1;
    while offset < bytes.len() {
        match bytes[offset] {
            b'(' | b'[' | b'{' => delimiters.push(bytes[offset]),
            b')' => {
                if delimiters.pop() != Some(b'(') {
                    return None;
                }
                if delimiters.is_empty() {
                    if argument_start < offset || !arguments.is_empty() {
                        arguments.push(argument_start..offset);
                    }
                    return Some((arguments, offset));
                }
            }
            b']' if delimiters.pop() != Some(b'[') => return None,
            b'}' if delimiters.pop() != Some(b'{') => return None,
            b',' if delimiters.len() == 1 => {
                arguments.push(argument_start..offset);
                argument_start = offset + 1;
            }
            _ => {}
        }
        offset += 1;
    }
    None
}

fn matching_opening_parenthesis(bytes: &[u8], closing_parenthesis: usize) -> Option<usize> {
    let mut depth = 0;
    for (offset, byte) in bytes[..=closing_parenthesis]
        .iter()
        .copied()
        .enumerate()
        .rev()
    {
        match byte {
            b')' => depth += 1,
            b'(' => {
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

fn is_three_include_directive(line: &[u8]) -> bool {
    let mut offset = skip_horizontal_whitespace(line, 0);
    if line.get(offset) != Some(&b'#') {
        return false;
    }
    offset = skip_horizontal_whitespace(line, offset + 1);
    if !consume_word(line, &mut offset, "include")
        || !matches!(line.get(offset), Some(b' ' | b'\t'))
    {
        return false;
    }
    offset = skip_horizontal_whitespace(line, offset);
    if line.get(offset) != Some(&b'<') {
        return false;
    }
    line[offset + 1..]
        .iter()
        .position(|byte| *byte == b'>')
        .is_some_and(|closing_offset| closing_offset > 0)
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
