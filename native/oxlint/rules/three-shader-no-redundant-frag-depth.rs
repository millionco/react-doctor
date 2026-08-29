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
pub struct ThreeShaderNoRedundantFragDepth;

declare_oxc_lint!(
    /// Disallow an unconditional redundant fragment-depth write.
    ThreeShaderNoRedundantFragDepth,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Shader redundantly writes fragment depth.",
);

impl Rule for ThreeShaderNoRedundantFragDepth {
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
            let Some((fragment_shader, _vertex_shader)) =
                effective_shader_expressions(options_object)
            else {
                continue;
            };
            let Some(fragment_shader) = fragment_shader else {
                continue;
            };
            let Some(shader_source) =
                resolve_static_shader_source(fragment_shader, ctx, &mut FxHashSet::default())
            else {
                continue;
            };
            let Some(assignment_offset) = redundant_fragment_depth_assignment(&shader_source.text)
            else {
                continue;
            };
            let utf16_offset = shader_source.text[..assignment_offset]
                .encode_utf16()
                .count();
            ctx.diagnostic(
                OxcDiagnostic::warn("This shader unconditionally writes the fixed-function depth value back to gl_FragDepth. Remove the redundant write so early depth testing remains available")
                    .with_label(shader_source.origin_span(utf16_offset)),
            );
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

fn redundant_fragment_depth_assignment(source: &str) -> Option<usize> {
    let Some(masked_source) = mask_parseable_glsl_source(source) else {
        return None;
    };
    let code_source = mask_glsl_directive_lines(masked_source);
    let bytes = code_source.as_bytes();
    let mut assignments = Vec::new();
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
        let identifier = &code_source[identifier_start..byte_offset];
        if !matches!(identifier, "gl_FragDepth" | "gl_FragDepthEXT")
            || bytes.get(identifier_start.wrapping_sub(1)) == Some(&b'.')
            || identifier_is_declaration_name(&code_source, identifier_start)
        {
            continue;
        }
        let operator_start =
            skip_wrapping_closing_parentheses(bytes, skip_ascii_whitespace(bytes, byte_offset));
        let Some((right_start, is_simple_assignment)) =
            fragment_depth_assignment_right_start(bytes, operator_start)
        else {
            continue;
        };
        assignments.push((
            identifier_start,
            is_simple_assignment && assignment_is_default_fragment_depth(bytes, right_start),
        ));
    }
    let [(assignment_offset, true)] = assignments.as_slice() else {
        return None;
    };
    assignment_is_unconditional_in_main(&code_source, *assignment_offset)
        .then_some(*assignment_offset)
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

fn fragment_depth_assignment_right_start(
    bytes: &[u8],
    operator_start: usize,
) -> Option<(usize, bool)> {
    let first = *bytes.get(operator_start)?;
    let second = bytes.get(operator_start + 1).copied();
    let third = bytes.get(operator_start + 2).copied();
    let (operator_length, is_simple_assignment) = match (first, second, third) {
        (b'=', Some(next), _) if next != b'=' => (1, true),
        (operator, Some(b'='), _)
            if matches!(
                operator,
                b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^'
            ) =>
        {
            (2, false)
        }
        (b'<', Some(b'<'), Some(b'=')) | (b'>', Some(b'>'), Some(b'=')) => (3, false),
        _ => return None,
    };
    Some((
        skip_ascii_whitespace(bytes, operator_start + operator_length),
        is_simple_assignment,
    ))
}

fn skip_wrapping_closing_parentheses(bytes: &[u8], mut offset: usize) -> usize {
    while bytes.get(offset) == Some(&b')') {
        offset = skip_ascii_whitespace(bytes, offset + 1);
    }
    offset
}

fn assignment_is_default_fragment_depth(bytes: &[u8], right_start: usize) -> bool {
    let mut expression_start = right_start;
    let mut wrapping_parenthesis_count = 0;
    while bytes.get(expression_start) == Some(&b'(') {
        wrapping_parenthesis_count += 1;
        expression_start = skip_ascii_whitespace(bytes, expression_start + 1);
    }
    let coordinate_name = b"gl_FragCoord";
    if bytes.get(expression_start..expression_start + coordinate_name.len())
        != Some(coordinate_name)
        || !is_identifier_boundary(bytes.get(expression_start + coordinate_name.len()).copied())
    {
        return false;
    }
    let dot_offset = skip_ascii_whitespace(bytes, expression_start + coordinate_name.len());
    if bytes.get(dot_offset) != Some(&b'.') {
        return false;
    }
    let component_offset = skip_ascii_whitespace(bytes, dot_offset + 1);
    if bytes.get(component_offset) != Some(&b'z')
        || !is_identifier_boundary(bytes.get(component_offset + 1).copied())
    {
        return false;
    }
    let mut expression_end = skip_ascii_whitespace(bytes, component_offset + 1);
    for _ in 0..wrapping_parenthesis_count {
        if bytes.get(expression_end) != Some(&b')') {
            return false;
        }
        expression_end = skip_ascii_whitespace(bytes, expression_end + 1);
    }
    matches!(bytes.get(expression_end), Some(b';' | b')' | b']' | b','))
}

fn assignment_is_unconditional_in_main(source: &str, assignment_offset: usize) -> bool {
    let bytes = source.as_bytes();
    let mut active_braces = Vec::new();
    for (byte_offset, byte) in bytes[..assignment_offset].iter().copied().enumerate() {
        match byte {
            b'{' => active_braces.push(byte_offset),
            b'}' => {
                active_braces.pop();
            }
            _ => {}
        }
    }
    let mut containing_function_name = None;
    for opening_brace in &active_braces {
        match brace_owner_name(bytes, *opening_brace) {
            Some("if" | "for" | "while" | "switch") => return false,
            Some(name) => containing_function_name = Some(name),
            None if brace_follows_word(bytes, *opening_brace, "else")
                || brace_follows_word(bytes, *opening_brace, "do") =>
            {
                return false;
            }
            None => {}
        }
    }
    if containing_function_name != Some("main") {
        return false;
    }
    let statement_start = unconditional_statement_start(bytes, assignment_offset);
    let statement_end = source[assignment_offset..]
        .find(';')
        .map_or(source.len(), |relative_offset| {
            assignment_offset + relative_offset
        });
    let statement = &source[statement_start..statement_end];
    !statement.contains("&&")
        && !statement.contains("||")
        && !statement.contains('?')
        && !source[statement_start..assignment_offset]
            .split(|character: char| !is_identifier_byte(character as u8))
            .any(|word| matches!(word, "if" | "else" | "for" | "while" | "switch" | "do"))
}

fn brace_owner_name(bytes: &[u8], opening_brace: usize) -> Option<&str> {
    let closing_parenthesis = previous_non_whitespace(bytes, opening_brace)?;
    if bytes[closing_parenthesis] != b')' {
        return None;
    }
    let opening_parenthesis = matching_opening_parenthesis(bytes, closing_parenthesis)?;
    let name_end = previous_non_whitespace(bytes, opening_parenthesis)? + 1;
    let name_start = bytes[..name_end]
        .iter()
        .rposition(|byte| !is_identifier_byte(*byte))
        .map_or(0, |offset| offset + 1);
    std::str::from_utf8(&bytes[name_start..name_end]).ok()
}

fn brace_follows_word(bytes: &[u8], opening_brace: usize, word: &str) -> bool {
    let Some(word_end) = previous_non_whitespace(bytes, opening_brace).map(|offset| offset + 1)
    else {
        return false;
    };
    let word_start = bytes[..word_end]
        .iter()
        .rposition(|byte| !is_identifier_byte(*byte))
        .map_or(0, |offset| offset + 1);
    bytes.get(word_start..word_end) == Some(word.as_bytes())
}

fn unconditional_statement_start(bytes: &[u8], assignment_offset: usize) -> usize {
    let mut delimiters = Vec::new();
    for (offset, byte) in bytes[..assignment_offset].iter().copied().enumerate().rev() {
        match byte {
            b')' | b']' => delimiters.push(byte),
            b'(' if delimiters.last() == Some(&b')') => {
                delimiters.pop();
            }
            b'[' if delimiters.last() == Some(&b']') => {
                delimiters.pop();
            }
            b';' | b'{' | b'}' if delimiters.is_empty() => return offset + 1,
            _ => {}
        }
    }
    0
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

fn previous_non_whitespace(bytes: &[u8], before: usize) -> Option<usize> {
    bytes[..before]
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
}

fn identifier_is_declaration_name(source: &str, identifier_start: usize) -> bool {
    let prefix = source[..identifier_start].trim_end();
    let type_end = prefix.len();
    let type_start = prefix
        .as_bytes()
        .iter()
        .rposition(|byte| !is_identifier_byte(*byte))
        .map_or(0, |offset| offset + 1);
    if type_start == type_end {
        return false;
    }
    let before_type = prefix[..type_start].trim_end();
    declaration_prefix_ends_at_boundary(before_type)
}

fn declaration_prefix_ends_at_boundary(mut prefix: &str) -> bool {
    loop {
        prefix = prefix.trim_end();
        if prefix.is_empty()
            || prefix
                .as_bytes()
                .last()
                .is_some_and(|byte| matches!(byte, b';' | b'{' | b'}' | b'(' | b','))
        {
            return true;
        }
        let word_end = prefix.len();
        let word_start = prefix
            .as_bytes()
            .iter()
            .rposition(|byte| !is_identifier_byte(*byte))
            .map_or(0, |offset| offset + 1);
        let word = &prefix[word_start..word_end];
        if !matches!(
            word,
            "const"
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
                | "smooth"
                | "volatile"
                | "writeonly"
        ) {
            return false;
        }
        prefix = &prefix[..word_start];
    }
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
