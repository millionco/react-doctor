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
pub struct ThreeShaderNoConstantOutOfBoundsIndex;

declare_oxc_lint!(
    /// Disallow constant array, vector, and matrix indices outside their bounds.
    ThreeShaderNoConstantOutOfBoundsIndex,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader uses a constant out-of-bounds index.",
);

impl Rule for ThreeShaderNoConstantOutOfBoundsIndex {
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
                for invalid_index in out_of_bounds_indices(&shader_source.text) {
                    let index = format_javascript_number(invalid_index.index);
                    let maximum_index = format_javascript_number(invalid_index.element_count - 1.0);
                    let message = format!(
                        "The constant index {index} is outside {}'s valid range 0–{maximum_index}, which is a GLSL compile error or undefined access",
                        invalid_index.declaration_name,
                    );
                    let utf16_offset = shader_source.text[..invalid_index.byte_offset]
                        .encode_utf16()
                        .count();
                    ctx.diagnostic(
                        OxcDiagnostic::error(message)
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

struct OutOfBoundsIndex {
    byte_offset: usize,
    declaration_name: String,
    element_count: f64,
    index: f64,
}

struct GlobalIndexDeclaration {
    element_counts: Vec<Option<f64>>,
    name_offset: usize,
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

fn out_of_bounds_indices(source: &str) -> Vec<OutOfBoundsIndex> {
    let Some(masked_source) = mask_parseable_glsl_source(source) else {
        return Vec::new();
    };
    let code_source = mask_glsl_directive_lines(masked_source);
    let declarations = collect_global_index_declarations(&code_source);
    let bytes = code_source.as_bytes();
    let mut findings = Vec::new();
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
        let Some(declaration) = declarations.get(identifier) else {
            continue;
        };
        if identifier_start == declaration.name_offset
            || bytes.get(identifier_start.wrapping_sub(1)) == Some(&b'.')
            || local_binding_shadows_identifier(&code_source, identifier, identifier_start)
        {
            continue;
        }
        let mut quantifier_offset = skip_ascii_whitespace(bytes, byte_offset);
        for element_count in &declaration.element_counts {
            if bytes.get(quantifier_offset) != Some(&b'[') {
                break;
            }
            let Some(closing_bracket) =
                matching_closing_delimiter(bytes, quantifier_offset, b'[', b']')
            else {
                break;
            };
            if let Some(element_count) = element_count
                && let Some(index) =
                    glsl_numeric_constant(&code_source[quantifier_offset + 1..closing_bracket])
                && index.fract() == 0.0
                && (index < 0.0 || index >= *element_count)
            {
                findings.push(OutOfBoundsIndex {
                    byte_offset: quantifier_offset,
                    declaration_name: identifier.to_string(),
                    element_count: *element_count,
                    index,
                });
            }
            quantifier_offset = skip_ascii_whitespace(bytes, closing_bracket + 1);
        }
    }
    findings
}

fn collect_global_index_declarations(
    source: &str,
) -> std::collections::HashMap<String, GlobalIndexDeclaration> {
    let bytes = source.as_bytes();
    let mut declarations = std::collections::HashMap::new();
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
                for (name, declaration) in
                    parse_global_index_declarations(source, statement_start, byte_offset)
                {
                    declarations.insert(name, declaration);
                }
                statement_start = byte_offset + 1;
            }
            _ => {}
        }
    }
    declarations
}

fn parse_global_index_declarations(
    source: &str,
    statement_start: usize,
    statement_end: usize,
) -> Vec<(String, GlobalIndexDeclaration)> {
    let tokens = tokenize_index_source(&source[statement_start..statement_end], statement_start);
    let mut token_index = 0;
    while tokens
        .get(token_index)
        .is_some_and(|token| token.text == "layout")
        && tokens
            .get(token_index + 1)
            .is_some_and(|token| token.text == "(")
    {
        token_index += 1;
        let Some(closing_parenthesis) = matching_index_token(&tokens, token_index, "(", ")") else {
            return Vec::new();
        };
        token_index = closing_parenthesis + 1;
    }
    while tokens
        .get(token_index)
        .is_some_and(|token| is_glsl_declaration_qualifier(token.text))
    {
        token_index += 1;
    }
    let Some(type_token) = tokens.get(token_index) else {
        return Vec::new();
    };
    if !type_token.is_identifier || type_token.text == "precision" || type_token.text == "struct" {
        return Vec::new();
    }
    token_index += 1;
    let type_array_size = parse_array_size(&tokens, &mut token_index);
    let type_element_counts = type_index_element_counts(type_token.text);
    let mut declarations = Vec::new();
    while token_index < tokens.len() {
        let Some(name_token) = tokens.get(token_index) else {
            break;
        };
        if !name_token.is_identifier {
            return Vec::new();
        }
        token_index += 1;
        if tokens
            .get(token_index)
            .is_some_and(|token| token.text == "(")
        {
            return Vec::new();
        }
        let declaration_array_size = parse_array_size(&tokens, &mut token_index);
        let mut element_counts = Vec::new();
        match (type_array_size, declaration_array_size) {
            (None, None) => {}
            (Some(type_size), None) => element_counts.push(type_size),
            (None, Some(declaration_size)) => element_counts.push(declaration_size),
            (Some(_), Some(_)) => element_counts.push(None),
        }
        element_counts.extend(
            type_element_counts
                .iter()
                .copied()
                .map(|element_count| Some(element_count as f64)),
        );
        if !element_counts.is_empty() {
            declarations.push((
                name_token.text.to_string(),
                GlobalIndexDeclaration {
                    element_counts,
                    name_offset: name_token.start,
                },
            ));
        }
        if tokens
            .get(token_index)
            .is_some_and(|token| token.text == "=")
        {
            token_index = next_top_level_index_comma(&tokens, token_index + 1);
        }
        if token_index == tokens.len() {
            break;
        }
        if tokens[token_index].text != "," {
            return Vec::new();
        }
        token_index += 1;
    }
    declarations
}

struct IndexToken<'a> {
    is_identifier: bool,
    start: usize,
    text: &'a str,
}

fn tokenize_index_source(source: &str, base_offset: usize) -> Vec<IndexToken<'_>> {
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
        if is_identifier {
            byte_offset += 1;
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
        } else if bytes[byte_offset].is_ascii_digit() || bytes[byte_offset] == b'.' {
            byte_offset += 1;
            while bytes.get(byte_offset).is_some_and(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-')
            }) {
                byte_offset += 1;
            }
        } else {
            byte_offset += 1;
        }
        tokens.push(IndexToken {
            is_identifier,
            start: base_offset + token_start,
            text: &source[token_start..byte_offset],
        });
    }
    tokens
}

fn parse_array_size(tokens: &[IndexToken<'_>], token_index: &mut usize) -> Option<Option<f64>> {
    if tokens
        .get(*token_index)
        .is_none_or(|token| token.text != "[")
    {
        return None;
    }
    let mut quantifier_count = 0;
    let mut size = None;
    while tokens
        .get(*token_index)
        .is_some_and(|token| token.text == "[")
    {
        let opening_bracket = *token_index;
        let closing_bracket = matching_index_token(tokens, opening_bracket, "[", "]")?;
        quantifier_count += 1;
        if quantifier_count == 1 {
            let size_source = tokens[opening_bracket + 1..closing_bracket]
                .iter()
                .map(|token| token.text)
                .collect::<String>();
            size = glsl_numeric_constant(&size_source);
        }
        *token_index = closing_bracket + 1;
    }
    Some((quantifier_count == 1).then_some(size).flatten())
}

fn matching_index_token(
    tokens: &[IndexToken<'_>],
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

fn next_top_level_index_comma(tokens: &[IndexToken<'_>], start: usize) -> usize {
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

fn type_index_element_counts(type_name: &str) -> Vec<usize> {
    for prefix in ["vec", "bvec", "ivec", "uvec", "dvec"] {
        if let Some(size) = type_name
            .strip_prefix(prefix)
            .and_then(|size| size.parse().ok())
            && matches!(size, 2..=4)
        {
            return vec![size];
        }
    }
    let Some(matrix_size) = type_name.strip_prefix("mat") else {
        return Vec::new();
    };
    let mut dimensions = matrix_size.split('x');
    let Some(columns) = dimensions
        .next()
        .and_then(|size| size.parse::<usize>().ok())
    else {
        return Vec::new();
    };
    let rows = dimensions
        .next()
        .and_then(|size| size.parse::<usize>().ok())
        .unwrap_or(columns);
    (matches!(columns, 2..=4) && matches!(rows, 2..=4) && dimensions.next().is_none())
        .then_some(vec![columns, rows])
        .unwrap_or_default()
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
        tokens_declare_name(
            &tokenize_index_source(&source[block_start..use_offset + name.len()], block_start),
            name,
        ) || block_header_declares_name(source, block_start - 1, name)
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
    tokens_declare_name(
        &tokenize_index_source(
            &source[opening_parenthesis + 1..closing_parenthesis],
            opening_parenthesis + 1,
        ),
        name,
    )
}

fn tokens_declare_name(tokens: &[IndexToken<'_>], name: &str) -> bool {
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

fn matching_closing_parenthesis(bytes: &[u8], opening_parenthesis: usize) -> Option<usize> {
    matching_closing_delimiter(bytes, opening_parenthesis, b'(', b')')
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

fn is_identifier_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
