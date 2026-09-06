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
const SMALL_INTEGER_POW_EXPONENTS: [u8; 3] = [2, 3, 4];
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
pub struct ThreeShaderPreferSmallIntegerPow;

declare_oxc_lint!(
    /// Prefer explicit multiplication over GLSL pow for small integer exponents.
    ThreeShaderPreferSmallIntegerPow,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Shader uses pow for a small integer exponent.",
);

impl Rule for ThreeShaderPreferSmallIntegerPow {
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
                for pow_call in small_integer_pow_calls(&shader_source.text) {
                    let message = format!(
                        "This pow call has the small integer exponent {}. Explicit multiplication avoids a general exponentiation operation and makes the intended cost clear",
                        pow_call.exponent
                    );
                    let utf16_offset = shader_source.text[..pow_call.byte_offset]
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

struct SmallIntegerPowCall {
    byte_offset: usize,
    exponent: u8,
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
    Some((fragment_shader, vertex_shader))
}

fn static_shader_property_name<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) if !property.computed => {
            Some(identifier.name.as_str())
        }
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        PropertyKey::TemplateLiteral(template)
            if property.computed && template.expressions.is_empty() =>
        {
            template.quasis.first().map(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
            })
        }
        _ => None,
    }
    .filter(|property_name| !property_name.is_empty())
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

fn small_integer_pow_calls(source: &str) -> Vec<SmallIntegerPowCall> {
    let Some(masked_source) = mask_glsl_comments(source) else {
        return Vec::new();
    };
    if has_conditional_glsl_directive(&masked_source)
        || has_glsl_function_like_macro(&masked_source, "pow")
    {
        return Vec::new();
    }
    let Some(masked_source) = mask_glsl_preprocessor_directives(masked_source) else {
        return Vec::new();
    };
    if !glsl_delimiters_are_balanced(&masked_source)
        || has_glsl_function_declaration(&masked_source, "pow")
    {
        return Vec::new();
    }
    let bytes = masked_source.as_bytes();
    let mut calls = Vec::new();
    let mut search_offset = 0;
    while search_offset + "pow".len() <= bytes.len() {
        let Some(relative_offset) = masked_source[search_offset..].find("pow") else {
            break;
        };
        let call_offset = search_offset + relative_offset;
        let name_end = call_offset + "pow".len();
        search_offset = name_end;
        if !is_identifier_boundary(bytes.get(call_offset.wrapping_sub(1)).copied())
            || !is_identifier_boundary(bytes.get(name_end).copied())
            || previous_non_whitespace_byte(bytes, call_offset) == Some(b'.')
        {
            continue;
        }
        let opening_parenthesis = skip_ascii_whitespace(bytes, name_end);
        if bytes.get(opening_parenthesis) != Some(&b'(') {
            continue;
        }
        let Some((argument_ranges, _)) = glsl_call_argument_ranges(bytes, opening_parenthesis)
        else {
            continue;
        };
        if argument_ranges.len() != 2 {
            continue;
        }
        let Some(exponent) = glsl_numeric_constant(&masked_source[argument_ranges[1].clone()])
        else {
            continue;
        };
        let Some(exponent) = SMALL_INTEGER_POW_EXPONENTS
            .iter()
            .copied()
            .find(|candidate| exponent == f64::from(*candidate))
        else {
            continue;
        };
        calls.push(SmallIntegerPowCall {
            byte_offset: call_offset,
            exponent,
        });
    }
    calls
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

fn glsl_numeric_constant(source: &str) -> Option<f64> {
    let mut candidate = source.trim();
    loop {
        if candidate.starts_with('(')
            && matching_closing_parenthesis(candidate.as_bytes(), 0)
                == Some(candidate.len().checked_sub(1)?)
        {
            candidate = candidate[1..candidate.len() - 1].trim();
            continue;
        }
        break;
    }
    let mut sign = 1.0;
    loop {
        if candidate.starts_with("++") || candidate.starts_with("--") {
            return None;
        }
        if let Some(rest) = candidate.strip_prefix('+') {
            candidate = rest.trim_start();
        } else if let Some(rest) = candidate.strip_prefix('-') {
            sign = -sign;
            candidate = rest.trim_start();
        } else {
            break;
        }
        while candidate.starts_with('(')
            && matching_closing_parenthesis(candidate.as_bytes(), 0)
                == Some(candidate.len().checked_sub(1)?)
        {
            candidate = candidate[1..candidate.len() - 1].trim();
        }
    }
    let value = parse_glsl_numeric_token(candidate)? * sign;
    value.is_finite().then_some(value)
}

fn parse_glsl_numeric_token(token: &str) -> Option<f64> {
    if token.is_empty() || token.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return None;
    }
    if token.ends_with('u') || token.ends_with('U') {
        return None;
    }
    if let Some(hexadecimal) = token
        .strip_prefix("0x")
        .or_else(|| token.strip_prefix("0X"))
    {
        return u64::from_str_radix(hexadecimal, 16)
            .ok()
            .map(|value| value as f64);
    }
    let token = token
        .strip_suffix("LF")
        .or_else(|| token.strip_suffix("lf"))
        .or_else(|| token.strip_suffix('F'))
        .or_else(|| token.strip_suffix('f'))
        .map_or(Some(token), |candidate| {
            candidate
                .bytes()
                .any(|byte| matches!(byte, b'.' | b'e' | b'E'))
                .then_some(candidate)
        })?;
    token.parse::<f64>().ok()
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

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
