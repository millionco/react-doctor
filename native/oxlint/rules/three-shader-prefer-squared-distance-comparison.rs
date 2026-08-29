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
pub struct ThreeShaderPreferSquaredDistanceComparison;

declare_oxc_lint!(
    /// Prefer squared distance comparisons over square-root-producing GLSL calls.
    ThreeShaderPreferSquaredDistanceComparison,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Shader compares a computed distance.",
);

impl Rule for ThreeShaderPreferSquaredDistanceComparison {
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
                for comparison in squared_distance_comparisons(&shader_source.text) {
                    let squared_threshold =
                        format_javascript_number(comparison.threshold * comparison.threshold);
                    let replacement = if comparison.function_name == "length" {
                        "length using dot(v, v)"
                    } else {
                        "distance using dot(a - b, a - b)"
                    };
                    let message = format!(
                        "Compare squared {replacement} against {squared_threshold} to avoid computing a square root"
                    );
                    let utf16_offset = shader_source.text[..comparison.byte_offset]
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

struct SquaredDistanceComparison {
    byte_offset: usize,
    function_name: &'static str,
    threshold: f64,
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

fn squared_distance_comparisons(source: &str) -> Vec<SquaredDistanceComparison> {
    let Some(masked_source) = mask_parseable_glsl_source(source) else {
        return Vec::new();
    };
    let code_source = mask_glsl_directive_lines(masked_source.clone());
    let bytes = code_source.as_bytes();
    let mut comparisons = Vec::new();
    for function_name in ["distance", "length"] {
        if has_glsl_function_like_macro(&masked_source, function_name)
            || has_glsl_function_declaration(&masked_source, function_name)
        {
            continue;
        }
        let mut search_offset = 0;
        while search_offset + function_name.len() <= bytes.len() {
            let Some(relative_offset) = code_source[search_offset..].find(function_name) else {
                break;
            };
            let call_start = search_offset + relative_offset;
            search_offset = call_start + function_name.len();
            if !is_identifier_boundary(bytes.get(call_start.wrapping_sub(1)).copied())
                || !is_identifier_boundary(bytes.get(search_offset).copied())
                || previous_non_whitespace(bytes, call_start)
                    .is_some_and(|offset| bytes[offset] == b'.')
            {
                continue;
            }
            let opening_parenthesis = skip_ascii_whitespace(bytes, search_offset);
            if bytes.get(opening_parenthesis) != Some(&b'(') {
                continue;
            }
            let Some((_, closing_parenthesis)) =
                glsl_call_argument_ranges(bytes, opening_parenthesis)
            else {
                continue;
            };
            let (operand_start, operand_end) =
                expand_grouped_operand(bytes, call_start, closing_parenthesis + 1);

            let operator_start = skip_ascii_whitespace(bytes, operand_end);
            if let Some(operator_end) = ordering_operator_at(bytes, operator_start)
                && operand_can_begin_comparison(bytes, operand_start)
                && let Some((threshold, threshold_end)) =
                    numeric_operand_after(&code_source, operator_end)
                && threshold >= 0.0
                && operand_can_end_comparison(bytes, threshold_end)
            {
                comparisons.push(SquaredDistanceComparison {
                    byte_offset: operand_start,
                    function_name,
                    threshold,
                });
            }

            if let Some(operator_start) = ordering_operator_before(bytes, operand_start)
                && operand_can_end_comparison(bytes, operand_end)
                && let Some((threshold, threshold_start)) =
                    numeric_operand_before(&code_source, operator_start)
                && threshold >= 0.0
                && operand_can_begin_comparison(bytes, threshold_start)
            {
                comparisons.push(SquaredDistanceComparison {
                    byte_offset: threshold_start,
                    function_name,
                    threshold,
                });
            }
        }
    }
    comparisons.sort_unstable_by_key(|comparison| comparison.byte_offset);
    comparisons
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

fn expand_grouped_operand(bytes: &[u8], mut start: usize, mut end: usize) -> (usize, usize) {
    loop {
        let Some(opening_parenthesis) = previous_non_whitespace(bytes, start) else {
            break;
        };
        let closing_parenthesis = skip_ascii_whitespace(bytes, end);
        if bytes[opening_parenthesis] != b'('
            || bytes.get(closing_parenthesis) != Some(&b')')
            || matching_closing_parenthesis(bytes, opening_parenthesis) != Some(closing_parenthesis)
            || previous_non_whitespace(bytes, opening_parenthesis)
                .is_some_and(|offset| is_identifier_byte(bytes[offset]))
        {
            break;
        }
        start = opening_parenthesis;
        end = closing_parenthesis + 1;
    }
    (start, end)
}

fn ordering_operator_at(bytes: &[u8], start: usize) -> Option<usize> {
    if !matches!(bytes.get(start), Some(b'<' | b'>'))
        || matches!(bytes.get(start + 1), Some(b'<' | b'>'))
        || bytes
            .get(start.wrapping_sub(1))
            .is_some_and(|byte| matches!(byte, b'<' | b'>'))
    {
        return None;
    }
    Some(start + 1 + usize::from(bytes.get(start + 1) == Some(&b'=')))
}

fn ordering_operator_before(bytes: &[u8], before: usize) -> Option<usize> {
    let operator_end = previous_non_whitespace(bytes, before)? + 1;
    let mut operator_start = operator_end - 1;
    if bytes[operator_start] == b'=' {
        operator_start = operator_start.checked_sub(1)?;
    }
    ordering_operator_at(bytes, operator_start)
        .filter(|candidate_end| *candidate_end == operator_end)
        .map(|_| operator_start)
}

fn numeric_operand_after(source: &str, after: usize) -> Option<(f64, usize)> {
    let bytes = source.as_bytes();
    let start = skip_ascii_whitespace(bytes, after);
    let mut offset = start;
    while matches!(bytes.get(offset), Some(b'+' | b'-')) {
        if bytes.get(offset + 1) == bytes.get(offset) {
            return None;
        }
        offset = skip_ascii_whitespace(bytes, offset + 1);
    }
    let end = if bytes.get(offset) == Some(&b'(') {
        matching_closing_parenthesis(bytes, offset)? + 1
    } else {
        numeric_token_end(bytes, offset)
    };
    let value = glsl_numeric_constant(&source[start..end])?;
    Some((value, end))
}

fn numeric_operand_before(source: &str, before: usize) -> Option<(f64, usize)> {
    let bytes = source.as_bytes();
    let end = previous_non_whitespace(bytes, before)? + 1;
    let mut start = if bytes[end - 1] == b')' {
        matching_opening_parenthesis(bytes, end - 1)?
    } else {
        numeric_token_start(bytes, end)
    };
    while let Some(sign_offset) = previous_non_whitespace(bytes, start)
        && matches!(bytes[sign_offset], b'+' | b'-')
        && unary_sign_at(bytes, sign_offset)
    {
        if bytes.get(sign_offset + 1) == Some(&bytes[sign_offset]) {
            return None;
        }
        start = sign_offset;
    }
    let value = glsl_numeric_constant(&source[start..end])?;
    Some((value, start))
}

fn numeric_token_end(bytes: &[u8], mut offset: usize) -> usize {
    while let Some(byte) = bytes.get(offset) {
        if byte.is_ascii_alphanumeric() || *byte == b'.' {
            offset += 1;
        } else if matches!(byte, b'+' | b'-')
            && offset > 0
            && matches!(bytes[offset - 1], b'e' | b'E')
        {
            offset += 1;
        } else {
            break;
        }
    }
    offset
}

fn numeric_token_start(bytes: &[u8], mut offset: usize) -> usize {
    while offset > 0 {
        let byte = bytes[offset - 1];
        if byte.is_ascii_alphanumeric() || byte == b'.' {
            offset -= 1;
        } else if matches!(byte, b'+' | b'-')
            && offset >= 2
            && matches!(bytes[offset - 2], b'e' | b'E')
        {
            offset -= 1;
        } else {
            break;
        }
    }
    offset
}

fn unary_sign_at(bytes: &[u8], sign_offset: usize) -> bool {
    previous_non_whitespace(bytes, sign_offset).is_none_or(|offset| {
        matches!(
            bytes[offset],
            b'(' | b'['
                | b'{'
                | b','
                | b';'
                | b'='
                | b'!'
                | b'?'
                | b':'
                | b'+'
                | b'-'
                | b'*'
                | b'/'
                | b'%'
                | b'<'
                | b'>'
                | b'&'
                | b'|'
                | b'^'
        )
    })
}

fn operand_can_begin_comparison(bytes: &[u8], start: usize) -> bool {
    let Some(previous_offset) = previous_non_whitespace(bytes, start) else {
        return true;
    };
    match bytes[previous_offset] {
        b'(' | b'[' | b'{' | b'}' | b',' | b';' | b'?' | b':' | b'&' | b'|' | b'^' => true,
        b'=' => !matches!(
            bytes.get(previous_offset.wrapping_sub(1)),
            Some(b'<' | b'>')
        ),
        b'!' => false,
        byte if is_identifier_byte(byte) => {
            let word_end = previous_offset + 1;
            let word_start = bytes[..word_end]
                .iter()
                .rposition(|byte| !is_identifier_byte(*byte))
                .map_or(0, |offset| offset + 1);
            let word = &bytes[word_start..word_end];
            word == b"case" || word == b"return"
        }
        _ => false,
    }
}

fn operand_can_end_comparison(bytes: &[u8], end: usize) -> bool {
    let next_offset = skip_ascii_whitespace(bytes, end);
    match bytes.get(next_offset) {
        None
        | Some(
            b')' | b']' | b'}' | b',' | b';' | b'?' | b':' | b'=' | b'!' | b'&' | b'|' | b'^'
            | b'<' | b'>',
        ) => true,
        _ => false,
    }
}

fn previous_non_whitespace(bytes: &[u8], before: usize) -> Option<usize> {
    bytes[..before]
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
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

fn glsl_numeric_constant(source: &str) -> Option<f64> {
    let candidate = source.trim_ascii();
    let value = if candidate.starts_with('(')
        && matching_closing_parenthesis(candidate.as_bytes(), 0)
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

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
