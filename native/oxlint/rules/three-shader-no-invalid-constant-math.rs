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
const GLSL_MAX_LDEXP_EXPONENT: f64 = 128.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeShaderNoInvalidConstantMath;

declare_oxc_lint!(
    /// Disallow constant GLSL operations outside their defined domains.
    ThreeShaderNoInvalidConstantMath,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader uses invalid constant math.",
);

impl Rule for ThreeShaderNoInvalidConstantMath {
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
                for finding in invalid_constant_math_findings(&shader_source.text) {
                    let utf16_offset = shader_source.text[..finding.byte_offset]
                        .encode_utf16()
                        .count();
                    ctx.diagnostic(
                        OxcDiagnostic::error(finding.message)
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

struct InvalidConstantMathFinding {
    byte_offset: usize,
    message: String,
    source_order: usize,
}

fn invalid_constant_math_findings(source: &str) -> Vec<InvalidConstantMathFinding> {
    let Some(source_without_comments) = mask_glsl_comments(source) else {
        return Vec::new();
    };
    if has_conditional_glsl_directive(&source_without_comments) {
        return Vec::new();
    }
    let Some(masked_source) = mask_glsl_preprocessor_directives(source_without_comments.clone())
    else {
        return Vec::new();
    };
    if !glsl_delimiters_are_balanced(&masked_source) {
        return Vec::new();
    }
    let mut findings = invalid_constant_zero_operator_findings(&masked_source);
    findings.extend(invalid_constant_function_findings(
        &masked_source,
        &source_without_comments,
        findings.len(),
    ));
    findings.sort_by_key(|finding| (finding.byte_offset, finding.source_order));
    findings
}

fn invalid_constant_zero_operator_findings(source: &str) -> Vec<InvalidConstantMathFinding> {
    let bytes = source.as_bytes();
    let mut findings = Vec::new();
    let mut byte_offset = 0;
    while byte_offset < bytes.len() {
        let operator = if matches!(bytes[byte_offset], b'/' | b'%') {
            if bytes.get(byte_offset + 1) == Some(&b'=') {
                Some((&source[byte_offset..byte_offset + 2], 2))
            } else {
                Some((&source[byte_offset..byte_offset + 1], 1))
            }
        } else {
            None
        };
        let Some((operator, operator_length)) = operator else {
            byte_offset += 1;
            continue;
        };
        let right_start = byte_offset + operator_length;
        let Some((right_end, divisor)) = glsl_numeric_constant_prefix(source, right_start) else {
            byte_offset += operator_length;
            continue;
        };
        let following_offset = skip_ascii_whitespace(bytes, right_end);
        if bytes
            .get(following_offset)
            .is_some_and(|byte| is_identifier_byte(*byte) || matches!(byte, b'.' | b'['))
            || divisor != 0.0
        {
            byte_offset += operator_length;
            continue;
        }
        let operation_name = if operator.starts_with('/') {
            "division"
        } else {
            "remainder"
        };
        findings.push(InvalidConstantMathFinding {
            byte_offset: glsl_operator_expression_start(source, byte_offset),
            message: format!("GLSL {operation_name} by a constant zero has undefined results"),
            source_order: findings.len(),
        });
        byte_offset += operator_length;
    }
    findings
}

fn invalid_constant_function_findings(
    source: &str,
    source_with_directives: &str,
    source_order_offset: usize,
) -> Vec<InvalidConstantMathFinding> {
    let bytes = source.as_bytes();
    let mut findings = Vec::new();
    let mut search_offset = 0;
    while search_offset < bytes.len() {
        while bytes
            .get(search_offset)
            .is_some_and(|byte| !is_identifier_start_byte(*byte))
        {
            search_offset += 1;
        }
        if search_offset == bytes.len() {
            break;
        }
        let name_offset = search_offset;
        search_offset += 1;
        while bytes
            .get(search_offset)
            .is_some_and(|byte| is_identifier_byte(*byte))
        {
            search_offset += 1;
        }
        let function_name = &source[name_offset..search_offset];
        if !is_constant_math_function_name(function_name)
            || previous_non_whitespace_byte(bytes, name_offset) == Some(b'.')
        {
            continue;
        }
        let opening_parenthesis = skip_ascii_whitespace(bytes, search_offset);
        if bytes.get(opening_parenthesis) != Some(&b'(') {
            continue;
        }
        let Some((argument_ranges, _)) = glsl_call_argument_ranges(bytes, opening_parenthesis)
        else {
            continue;
        };
        if has_glsl_function_like_macro(source_with_directives, function_name)
            || has_glsl_function_declaration(source, function_name)
        {
            continue;
        }
        let Some(message) =
            invalid_constant_function_message(source, function_name, &argument_ranges)
        else {
            continue;
        };
        findings.push(InvalidConstantMathFinding {
            byte_offset: name_offset,
            message,
            source_order: source_order_offset + findings.len(),
        });
    }
    findings
}

fn invalid_constant_function_message(
    source: &str,
    function_name: &str,
    argument_ranges: &[std::ops::Range<usize>],
) -> Option<String> {
    let first_argument = argument_ranges.first()?;
    let first_value = glsl_numeric_constant(&source[first_argument.clone()]);
    if matches!(function_name, "asin" | "acos") {
        return first_value.filter(|value| value.abs() > 1.0).map(|value| {
            format!(
                "GLSL {function_name} is undefined outside the range -1 to 1, but received {}",
                format_javascript_number(value)
            )
        });
    }
    if function_name == "atan" && argument_ranges.len() == 2 {
        let second_value = glsl_numeric_constant(&source[argument_ranges[1].clone()]);
        return (first_value == Some(0.0) && second_value == Some(0.0))
            .then(|| "GLSL atan is undefined when both arguments are zero".to_string());
    }
    if function_name == "acosh" {
        return first_value.filter(|value| *value < 1.0).map(|value| {
            format!(
                "GLSL acosh is undefined below 1, but received {}",
                format_javascript_number(value)
            )
        });
    }
    if function_name == "atanh" {
        return first_value.filter(|value| value.abs() >= 1.0).map(|value| {
            format!(
                "GLSL atanh is undefined outside the range -1 to 1, but received {}",
                format_javascript_number(value)
            )
        });
    }
    if function_name == "ldexp" && argument_ranges.len() == 2 {
        let exponent = glsl_numeric_constant(&source[argument_ranges[1].clone()]);
        return exponent
            .filter(|value| *value > GLSL_MAX_LDEXP_EXPONENT)
            .map(|value| {
                format!(
                    "GLSL ldexp is undefined above exponent 128, but received {}",
                    format_javascript_number(value)
                )
            });
    }
    if function_name == "pow" {
        if let Some(first_value) = first_value.filter(|value| *value < 0.0) {
            return Some(format!(
                "GLSL pow is undefined for the negative base {}",
                format_javascript_number(first_value)
            ));
        }
        let exponent = argument_ranges
            .get(1)
            .and_then(|argument| glsl_numeric_constant(&source[argument.clone()]));
        return (first_value == Some(0.0))
            .then_some(exponent)
            .flatten()
            .filter(|value| *value <= 0.0)
            .map(|value| {
                format!(
                    "GLSL pow is undefined for a zero base and the nonpositive exponent {}",
                    format_javascript_number(value)
                )
            });
    }
    if function_name == "sqrt" {
        return first_value.filter(|value| *value < 0.0).map(|value| {
            format!(
                "GLSL sqrt is undefined for the negative argument {}",
                format_javascript_number(value)
            )
        });
    }
    if matches!(function_name, "inversesqrt" | "log" | "log2") {
        return first_value.filter(|value| *value <= 0.0).map(|value| {
            format!(
                "GLSL {function_name} is undefined for the nonpositive argument {}",
                format_javascript_number(value)
            )
        });
    }
    if function_name != "mod" || argument_ranges.len() != 2 {
        return None;
    }
    let divisor = glsl_numeric_constant(&source[argument_ranges[1].clone()]);
    (divisor == Some(0.0)).then(|| "GLSL mod is undefined with a zero divisor".to_string())
}

fn is_constant_math_function_name(name: &str) -> bool {
    matches!(
        name,
        "acos"
            | "acosh"
            | "asin"
            | "atan"
            | "atanh"
            | "inversesqrt"
            | "ldexp"
            | "log"
            | "log2"
            | "mod"
            | "pow"
            | "sqrt"
    )
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
    } else if candidate.starts_with("++") || candidate.starts_with("--") {
        return None;
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
    let (token, requires_floating_syntax) =
        if let Some(token) = token.strip_suffix('U').or_else(|| token.strip_suffix('u')) {
            if token.bytes().any(|byte| matches!(byte, b'.' | b'e' | b'E')) {
                return None;
            }
            (token, false)
        } else if let Some(token) = token
            .strip_suffix("LF")
            .or_else(|| token.strip_suffix("lf"))
            .or_else(|| token.strip_suffix('F'))
            .or_else(|| token.strip_suffix('f'))
        {
            (token, true)
        } else {
            (token, false)
        };
    if requires_floating_syntax && !token.bytes().any(|byte| matches!(byte, b'.' | b'e' | b'E')) {
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
    token.parse::<f64>().ok()
}

fn glsl_numeric_constant_prefix(source: &str, start: usize) -> Option<(usize, f64)> {
    let bytes = source.as_bytes();
    let mut value_start = skip_ascii_whitespace(bytes, start);
    let mut scan_offset = value_start;
    loop {
        let Some(sign @ (b'+' | b'-')) = bytes.get(scan_offset).copied() else {
            break;
        };
        if bytes.get(scan_offset + 1) == Some(&sign) {
            break;
        }
        scan_offset = skip_ascii_whitespace(bytes, scan_offset + 1);
    }
    if bytes.get(scan_offset) == Some(&b'(') {
        let closing_parenthesis = matching_closing_parenthesis(bytes, scan_offset)?;
        let value_end = closing_parenthesis + 1;
        let value = glsl_numeric_constant(&source[value_start..value_end])?;
        return Some((value_end, value));
    }
    value_start = skip_ascii_whitespace(bytes, value_start);
    let value_end = glsl_numeric_token_end(bytes, scan_offset);
    if value_end == scan_offset {
        return None;
    }
    let value = glsl_numeric_constant(&source[value_start..value_end])?;
    Some((value_end, value))
}

fn glsl_numeric_token_end(bytes: &[u8], start: usize) -> usize {
    let mut offset = start;
    while let Some(byte) = bytes.get(offset) {
        if byte.is_ascii_alphanumeric() || *byte == b'.' {
            offset += 1;
            continue;
        }
        if matches!(byte, b'+' | b'-')
            && offset > start
            && matches!(bytes.get(offset - 1), Some(b'e' | b'E'))
        {
            offset += 1;
            continue;
        }
        break;
    }
    offset
}

fn glsl_operator_expression_start(source: &str, operator_offset: usize) -> usize {
    let bytes = source.as_bytes();
    let mut start = operator_offset;
    let mut parenthesis_depth = 0;
    let mut bracket_depth = 0;
    while start > 0 {
        let previous_offset = start - 1;
        match bytes[previous_offset] {
            b')' => parenthesis_depth += 1,
            b']' => bracket_depth += 1,
            b'(' if parenthesis_depth > 0 => parenthesis_depth -= 1,
            b'[' if bracket_depth > 0 => bracket_depth -= 1,
            b';' | b'{' | b'}' | b',' | b'=' | b'?' | b':'
                if parenthesis_depth == 0 && bracket_depth == 0 =>
            {
                break;
            }
            b'+' | b'-' | b'|' | b'&' | b'^' | b'<' | b'>'
                if parenthesis_depth == 0 && bracket_depth == 0 =>
            {
                break;
            }
            _ => {}
        }
        start = previous_offset;
    }
    skip_ascii_whitespace(bytes, start)
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
