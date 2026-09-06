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
pub struct ThreeShaderRequireFragmentOutputOnAllPaths;

declare_oxc_lint!(
    /// Require fragment main to assign every used color output on all supported paths.
    ThreeShaderRequireFragmentOutputOnAllPaths,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Fragment shader leaves a color output undefined.",
);

impl Rule for ThreeShaderRequireFragmentOutputOnAllPaths {
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
            let Some((fragment_shader, _)) = effective_shader_expressions(options_object) else {
                continue;
            };
            let Some(fragment_shader_expression) = fragment_shader else {
                continue;
            };
            let Some(shader_source) = resolve_static_shader_source(
                fragment_shader_expression,
                ctx,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            for output_name in fragment_output_names(&shader_source.text) {
                let Some(analysis) = analyze_vector_writes(&shader_source.text, &output_name)
                else {
                    continue;
                };
                if analysis.writes_vector_on_all_paths {
                    continue;
                }
                let utf16_offset = shader_source.text[..analysis.main_byte_offset]
                    .encode_utf16()
                    .count();
                let message = format!(
                    "At least one non-discarded path through fragment main leaves {output_name} partially or completely undefined"
                );
                ctx.diagnostic(
                    OxcDiagnostic::error(message)
                        .with_label(shader_source.origin_span(utf16_offset)),
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

struct VectorWriteAnalysis {
    main_byte_offset: usize,
    writes_vector_on_all_paths: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GlslTokenKind {
    Identifier,
    Symbol,
}

#[derive(Clone, Copy)]
struct GlslToken<'a> {
    kind: GlslTokenKind,
    text: &'a str,
    start: usize,
}

struct GlslFunction {
    body_close_token_index: usize,
    body_open_token_index: usize,
    name_token_index: usize,
    source_byte_offset: usize,
}

struct VectorExecutionResult {
    active_states: FxHashSet<u8>,
    has_unwritten_return: bool,
    is_supported: bool,
}

struct StatementAnalysis {
    next_token_index: usize,
    result: VectorExecutionResult,
}

const ALL_VECTOR_COMPONENTS: u8 = 0b1111;
const NO_VECTOR_COMPONENTS: u8 = 0;

fn fragment_output_names(source: &str) -> Vec<String> {
    let source_without_comments = mask_glsl_comments(source);
    if has_glsl_directive(
        &source_without_comments,
        &["if", "ifdef", "ifndef", "elif", "else", "endif"],
    ) {
        return Vec::new();
    }
    let source_for_tokens = mask_three_include_directives(&source_without_comments);
    let Some(tokens) = tokenize_glsl(&source_for_tokens) else {
        return Vec::new();
    };
    let mut output_names = Vec::new();
    let mut brace_depth: usize = 0;
    let mut statement_start = 0;
    for token_index in 0..tokens.len() {
        match tokens[token_index].text {
            "{" => brace_depth += 1,
            "}" => {
                brace_depth -= 1;
                if brace_depth == 0 {
                    statement_start = token_index + 1;
                }
            }
            ";" if brace_depth == 0 => {
                collect_fragment_output_names_from_statement(
                    &tokens,
                    statement_start,
                    token_index,
                    &mut output_names,
                );
                statement_start = token_index + 1;
            }
            _ => {}
        }
    }
    if tokens.iter().any(|token| token.text == "gl_FragColor")
        && !output_names.iter().any(|name| name == "gl_FragColor")
    {
        output_names.push("gl_FragColor".to_string());
    }
    output_names
}

fn collect_fragment_output_names_from_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    output_names: &mut Vec<String>,
) {
    let mut delimiters = Vec::new();
    let mut top_level_indices = Vec::new();
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" => {
                delimiters.pop();
            }
            "]" | "}" => {
                delimiters.pop();
            }
            _ if delimiters.is_empty() => top_level_indices.push(token_index),
            _ => {}
        }
    }
    let Some(vec4_position) = top_level_indices
        .iter()
        .position(|token_index| tokens[*token_index].text == "vec4")
    else {
        return;
    };
    if !top_level_indices[..vec4_position]
        .iter()
        .any(|token_index| tokens[*token_index].text == "out")
    {
        return;
    }
    let vec4_token_index = top_level_indices[vec4_position];
    if tokens.get(vec4_token_index + 1).map(|token| token.text) == Some("[") {
        return;
    }
    let declarator_indices = &top_level_indices[vec4_position + 1..];
    let mut declarator_start = 0;
    for declarator_end in (0..=declarator_indices.len()).filter(|index| {
        *index == declarator_indices.len() || tokens[declarator_indices[*index]].text == ","
    }) {
        if let Some(name_index) = declarator_indices
            .get(declarator_start..declarator_end)
            .and_then(|indices| indices.first())
            .copied()
            && tokens[name_index].kind == GlslTokenKind::Identifier
            && tokens.get(name_index + 1).map(|token| token.text) != Some("[")
            && tokens.iter().enumerate().any(|(token_index, token)| {
                token.text == tokens[name_index].text && token_index != name_index
            })
            && !output_names
                .iter()
                .any(|name| name == tokens[name_index].text)
        {
            output_names.push(tokens[name_index].text.to_string());
        }
        declarator_start = declarator_end + 1;
    }
}

fn analyze_vector_writes(source: &str, target_identifier: &str) -> Option<VectorWriteAnalysis> {
    let source_without_comments = mask_glsl_comments(source);
    if has_glsl_directive(
        &source_without_comments,
        &["if", "ifdef", "ifndef", "elif", "else", "endif"],
    ) {
        return None;
    }
    let source_for_tokens = mask_three_include_directives(&source_without_comments);
    let mut tokens = tokenize_glsl(&source_for_tokens)?;
    for token in &mut tokens {
        if token.text == target_identifier {
            token.text = "gl_Position";
        }
    }
    let functions = collect_glsl_functions(&tokens)?;
    let main_function = functions.iter().find(|function| {
        tokens[function.name_token_index].text == "main"
            && tokens[function.body_open_token_index].text == "{"
    })?;
    if has_glsl_directive(&source_without_comments, &["define"]) {
        return None;
    }
    let declared_function_names = functions
        .iter()
        .map(|function| tokens[function.name_token_index].text)
        .collect::<FxHashSet<_>>();
    if calls_declared_function(
        &tokens,
        main_function.body_open_token_index + 1,
        main_function.body_close_token_index,
        &declared_function_names,
    ) {
        return None;
    }
    let result = analyze_compound_tokens(
        &tokens,
        main_function.body_open_token_index + 1,
        main_function.body_close_token_index,
        FxHashSet::from_iter([NO_VECTOR_COMPONENTS]),
    );
    if !result.is_supported {
        return None;
    }
    Some(VectorWriteAnalysis {
        main_byte_offset: main_function.source_byte_offset,
        writes_vector_on_all_paths: !result.has_unwritten_return
            && result
                .active_states
                .iter()
                .all(|state| *state == ALL_VECTOR_COMPONENTS),
    })
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

fn mask_three_include_directives(source: &str) -> String {
    let mut bytes = source.as_bytes().to_vec();
    let mut line_start = 0;
    while line_start <= bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|byte| matches!(byte, b'\r' | b'\n'))
            .map_or(bytes.len(), |offset| line_start + offset);
        if is_three_include_directive(&bytes[line_start..line_end]) {
            bytes[line_start..line_end].fill(b' ');
        }
        if line_end == bytes.len() {
            break;
        }
        line_start = line_end + 1;
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
        if is_identifier_start(bytes[byte_offset]) {
            byte_offset += 1;
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                byte_offset += 1;
            }
            tokens.push(GlslToken {
                kind: GlslTokenKind::Identifier,
                text: &source[token_start..byte_offset],
                start: token_start,
            });
            continue;
        }
        if bytes[byte_offset].is_ascii_digit() || bytes[byte_offset] == b'.' {
            byte_offset += 1;
            while bytes.get(byte_offset).is_some_and(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-')
            }) {
                byte_offset += 1;
            }
            tokens.push(GlslToken {
                kind: GlslTokenKind::Symbol,
                text: &source[token_start..byte_offset],
                start: token_start,
            });
            continue;
        }
        if !bytes[byte_offset].is_ascii() {
            return None;
        }
        let operator_length = [3, 2].into_iter().find(|length| {
            source
                .get(token_start..token_start + length)
                .is_some_and(|candidate| {
                    matches!(
                        candidate,
                        "<<="
                            | ">>="
                            | "++"
                            | "--"
                            | "=="
                            | "!="
                            | "<="
                            | ">="
                            | "&&"
                            | "||"
                            | "^^"
                            | "+="
                            | "-="
                            | "*="
                            | "/="
                            | "%="
                            | "<<"
                            | ">>"
                            | "&="
                            | "|="
                            | "^="
                    )
                })
        });
        byte_offset += operator_length.unwrap_or(1);
        let text = &source[token_start..byte_offset];
        if text.starts_with('"') || text.starts_with('\'') {
            return None;
        }
        tokens.push(GlslToken {
            kind: GlslTokenKind::Symbol,
            text,
            start: token_start,
        });
    }
    delimiters_are_balanced(&tokens).then_some(tokens)
}

fn collect_glsl_functions(tokens: &[GlslToken<'_>]) -> Option<Vec<GlslFunction>> {
    let mut functions = Vec::new();
    let mut brace_depth: usize = 0;
    let mut token_index = 0;
    while token_index < tokens.len() {
        match tokens[token_index].text {
            "{" => {
                brace_depth += 1;
                token_index += 1;
                continue;
            }
            "}" => {
                brace_depth = brace_depth.checked_sub(1)?;
                token_index += 1;
                continue;
            }
            _ => {}
        }
        if brace_depth != 0
            || tokens[token_index].kind != GlslTokenKind::Identifier
            || tokens.get(token_index + 1).map(|token| token.text) != Some("(")
            || token_index == 0
            || tokens[token_index - 1].kind != GlslTokenKind::Identifier
        {
            token_index += 1;
            continue;
        }
        let closing_parenthesis = matching_token(tokens, token_index + 1, "(", ")")?;
        let following_token = tokens.get(closing_parenthesis + 1).map(|token| token.text);
        if following_token == Some("{") {
            let body_close_token_index = matching_token(tokens, closing_parenthesis + 1, "{", "}")?;
            let signature_start = function_signature_start(tokens, token_index);
            functions.push(GlslFunction {
                body_close_token_index,
                body_open_token_index: closing_parenthesis + 1,
                name_token_index: token_index,
                source_byte_offset: tokens[signature_start].start,
            });
            token_index = body_close_token_index + 1;
            continue;
        }
        if following_token == Some(";") {
            functions.push(GlslFunction {
                body_close_token_index: closing_parenthesis,
                body_open_token_index: closing_parenthesis,
                name_token_index: token_index,
                source_byte_offset: tokens[function_signature_start(tokens, token_index)].start,
            });
            token_index = closing_parenthesis + 2;
            continue;
        }
        token_index += 1;
    }
    Some(functions)
}

fn function_signature_start(tokens: &[GlslToken<'_>], name_token_index: usize) -> usize {
    let mut signature_start = name_token_index - 1;
    while signature_start > 0
        && tokens[signature_start - 1].kind == GlslTokenKind::Identifier
        && matches!(
            tokens[signature_start - 1].text,
            "const" | "highp" | "mediump" | "lowp" | "in" | "out" | "inout" | "precise"
        )
    {
        signature_start -= 1;
    }
    signature_start
}

fn calls_declared_function(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    declared_function_names: &FxHashSet<&str>,
) -> bool {
    (start..end).any(|token_index| {
        tokens[token_index].kind == GlslTokenKind::Identifier
            && tokens.get(token_index + 1).map(|token| token.text) == Some("(")
            && declared_function_names.contains(tokens[token_index].text)
    })
}

fn analyze_compound_tokens(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    mut active_states: FxHashSet<u8>,
) -> VectorExecutionResult {
    let mut has_unwritten_return = false;
    let mut token_index = start;
    while token_index < end {
        if active_states.is_empty() {
            break;
        }
        if tokens[token_index].text == ";" {
            token_index += 1;
            continue;
        }
        let analysis = analyze_statement_tokens(tokens, token_index, end, active_states);
        if !analysis.result.is_supported {
            return analysis.result;
        }
        token_index = analysis.next_token_index;
        active_states = analysis.result.active_states;
        has_unwritten_return |= analysis.result.has_unwritten_return;
    }
    VectorExecutionResult {
        active_states,
        has_unwritten_return,
        is_supported: true,
    }
}

fn analyze_statement_tokens(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    input_states: FxHashSet<u8>,
) -> StatementAnalysis {
    if start >= end {
        return supported_statement(end, input_states, false);
    }
    match tokens[start].text {
        "{" => {
            let Some(close) = matching_token(tokens, start, "{", "}") else {
                return unsupported_statement(end, input_states);
            };
            let result = analyze_compound_tokens(tokens, start + 1, close, input_states);
            StatementAnalysis {
                next_token_index: close + 1,
                result,
            }
        }
        "if" => analyze_if_statement(tokens, start, end, input_states),
        "for" => analyze_for_statement(tokens, start, end, input_states),
        "while" => analyze_while_statement(tokens, start, end, input_states),
        "return" => {
            let Some(next) = statement_end(tokens, start + 1, end) else {
                return unsupported_statement(end, input_states);
            };
            let has_unwritten_return = input_states
                .iter()
                .any(|state| *state != ALL_VECTOR_COMPONENTS);
            supported_statement(next, FxHashSet::default(), has_unwritten_return)
        }
        "discard" => {
            let Some(next) = statement_end(tokens, start + 1, end) else {
                return unsupported_statement(end, input_states);
            };
            supported_statement(next, FxHashSet::default(), false)
        }
        "do" | "switch" | "break" | "continue" => unsupported_statement(end, input_states),
        _ => analyze_expression_or_declaration_statement(tokens, start, end, input_states),
    }
}

fn analyze_if_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    input_states: FxHashSet<u8>,
) -> StatementAnalysis {
    if tokens.get(start + 1).map(|token| token.text) != Some("(") {
        return unsupported_statement(end, input_states);
    }
    let Some(condition_close) = matching_token(tokens, start + 1, "(", ")") else {
        return unsupported_statement(end, input_states);
    };
    if expression_contains_vector_write(tokens, start + 2, condition_close) {
        return unsupported_statement(end, input_states);
    }
    let consequent =
        analyze_statement_tokens(tokens, condition_close + 1, end, input_states.clone());
    if !consequent.result.is_supported {
        return consequent;
    }
    let (alternate, next_token_index) = if tokens
        .get(consequent.next_token_index)
        .map(|token| token.text)
        == Some("else")
    {
        let alternate = analyze_statement_tokens(
            tokens,
            consequent.next_token_index + 1,
            end,
            input_states.clone(),
        );
        let next_token_index = alternate.next_token_index;
        (alternate, next_token_index)
    } else {
        (
            supported_statement(consequent.next_token_index, input_states, false),
            consequent.next_token_index,
        )
    };
    if !alternate.result.is_supported {
        return alternate;
    }
    let condition = boolean_constant(tokens, start + 2, condition_close);
    if condition == Some(true) {
        return StatementAnalysis {
            next_token_index,
            result: consequent.result,
        };
    }
    if condition == Some(false) {
        return StatementAnalysis {
            next_token_index,
            result: alternate.result,
        };
    }
    let mut active_states = consequent.result.active_states;
    active_states.extend(alternate.result.active_states);
    supported_statement(
        next_token_index,
        active_states,
        consequent.result.has_unwritten_return || alternate.result.has_unwritten_return,
    )
}

fn analyze_for_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    input_states: FxHashSet<u8>,
) -> StatementAnalysis {
    if tokens.get(start + 1).map(|token| token.text) != Some("(") {
        return unsupported_statement(end, input_states);
    }
    let Some(control_close) = matching_token(tokens, start + 1, "(", ")") else {
        return unsupported_statement(end, input_states);
    };
    let Some(control_ranges) = split_top_level_ranges(tokens, start + 2, control_close, ";") else {
        return unsupported_statement(end, input_states);
    };
    if control_ranges.len() != 3
        || control_ranges
            .iter()
            .any(|(range_start, range_end)| range_start == range_end)
        || control_ranges.iter().any(|(range_start, range_end)| {
            expression_contains_vector_write(tokens, *range_start, *range_end)
        })
    {
        return unsupported_statement(end, input_states);
    }
    let body = analyze_statement_tokens(tokens, control_close + 1, end, input_states.clone());
    if !body.result.is_supported {
        return body;
    }
    supported_statement(
        body.next_token_index,
        input_states,
        body.result.has_unwritten_return,
    )
}

fn analyze_while_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    input_states: FxHashSet<u8>,
) -> StatementAnalysis {
    if tokens.get(start + 1).map(|token| token.text) != Some("(") {
        return unsupported_statement(end, input_states);
    }
    let Some(condition_close) = matching_token(tokens, start + 1, "(", ")") else {
        return unsupported_statement(end, input_states);
    };
    if expression_contains_vector_write(tokens, start + 2, condition_close) {
        return unsupported_statement(end, input_states);
    }
    let body = analyze_statement_tokens(tokens, condition_close + 1, end, input_states.clone());
    if !body.result.is_supported {
        return body;
    }
    supported_statement(
        body.next_token_index,
        input_states,
        body.result.has_unwritten_return,
    )
}

fn analyze_expression_or_declaration_statement(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    input_states: FxHashSet<u8>,
) -> StatementAnalysis {
    let Some(next_token_index) = statement_end(tokens, start, end) else {
        return unsupported_statement(end, input_states);
    };
    let expression_end = next_token_index - 1;
    let is_declaration = statement_is_declaration(tokens, start, expression_end);
    let contains_write = expression_contains_vector_write(tokens, start, expression_end);
    if is_declaration {
        return if contains_write {
            unsupported_statement(next_token_index, input_states)
        } else {
            supported_statement(next_token_index, input_states, false)
        };
    }
    let write_mask = expression_vector_write_mask(tokens, start, expression_end);
    if write_mask == NO_VECTOR_COMPONENTS && contains_write {
        return unsupported_statement(next_token_index, input_states);
    }
    let active_states = if write_mask == NO_VECTOR_COMPONENTS {
        input_states
    } else {
        input_states
            .into_iter()
            .map(|state| state | write_mask)
            .collect()
    };
    supported_statement(next_token_index, active_states, false)
}

fn expression_vector_write_mask(tokens: &[GlslToken<'_>], start: usize, end: usize) -> u8 {
    let (start, end) = strip_group_tokens(tokens, start, end);
    if start >= end {
        return NO_VECTOR_COMPONENTS;
    }
    if let Some(ranges) = split_top_level_ranges(tokens, start, end, ",")
        && ranges.len() > 1
    {
        return ranges
            .into_iter()
            .fold(NO_VECTOR_COMPONENTS, |mask, range| {
                mask | expression_vector_write_mask(tokens, range.0, range.1)
            });
    }
    if let Some((question, colon)) = top_level_ternary_tokens(tokens, start, end) {
        return expression_vector_write_mask(tokens, question + 1, colon)
            & expression_vector_write_mask(tokens, colon + 1, end);
    }
    let Some(assignment_index) = find_top_level_token(tokens, start, end, "=") else {
        return NO_VECTOR_COMPONENTS;
    };
    assignment_target_vector_mask(tokens, start, assignment_index)
}

fn expression_contains_vector_write(tokens: &[GlslToken<'_>], start: usize, end: usize) -> bool {
    (start..end).any(|token_index| {
        tokens[token_index].text == "="
            && assignment_vector_mask_before(tokens, start, token_index) != NO_VECTOR_COMPONENTS
    })
}

fn assignment_vector_mask_before(
    tokens: &[GlslToken<'_>],
    start: usize,
    assignment_index: usize,
) -> u8 {
    if assignment_index > start
        && tokens[assignment_index - 1].text == "gl_Position"
        && (assignment_index < 2 || tokens[assignment_index - 2].text != ".")
    {
        return ALL_VECTOR_COMPONENTS;
    }
    if assignment_index >= start + 3
        && tokens[assignment_index - 3].text == "gl_Position"
        && tokens[assignment_index - 2].text == "."
        && tokens[assignment_index - 1].kind == GlslTokenKind::Identifier
        && (assignment_index < 4 || tokens[assignment_index - 4].text != ".")
    {
        return vector_swizzle_mask(tokens[assignment_index - 1].text);
    }
    NO_VECTOR_COMPONENTS
}

fn assignment_target_vector_mask(tokens: &[GlslToken<'_>], start: usize, end: usize) -> u8 {
    let (start, end) = strip_group_tokens(tokens, start, end);
    if end == start + 1 && tokens[start].text == "gl_Position" {
        return ALL_VECTOR_COMPONENTS;
    }
    if end == start + 3
        && tokens[start].text == "gl_Position"
        && tokens[start + 1].text == "."
        && tokens[start + 2].kind == GlslTokenKind::Identifier
    {
        return vector_swizzle_mask(tokens[start + 2].text);
    }
    NO_VECTOR_COMPONENTS
}

fn vector_swizzle_mask(selection: &str) -> u8 {
    let mut mask = NO_VECTOR_COMPONENTS;
    for component in selection.bytes() {
        let component_mask = match component {
            b'x' | b'r' | b's' => 0b0001,
            b'y' | b'g' | b't' => 0b0010,
            b'z' | b'b' | b'p' => 0b0100,
            b'w' | b'a' | b'q' => 0b1000,
            _ => return NO_VECTOR_COMPONENTS,
        };
        mask |= component_mask;
    }
    mask
}

fn statement_is_declaration(tokens: &[GlslToken<'_>], start: usize, end: usize) -> bool {
    let mut token_index = start;
    while token_index < end
        && matches!(
            tokens[token_index].text,
            "const"
                | "attribute"
                | "uniform"
                | "varying"
                | "in"
                | "out"
                | "inout"
                | "centroid"
                | "flat"
                | "smooth"
                | "noperspective"
                | "highp"
                | "mediump"
                | "lowp"
                | "precision"
                | "invariant"
                | "precise"
        )
    {
        token_index += 1;
    }
    if token_index >= end || tokens[token_index].kind != GlslTokenKind::Identifier {
        return false;
    }
    if is_glsl_type_name(tokens[token_index].text) {
        return true;
    }
    tokens
        .get(token_index + 1)
        .is_some_and(|token| token.kind == GlslTokenKind::Identifier)
}

fn is_glsl_type_name(name: &str) -> bool {
    matches!(
        name,
        "void"
            | "bool"
            | "int"
            | "uint"
            | "float"
            | "double"
            | "vec2"
            | "vec3"
            | "vec4"
            | "bvec2"
            | "bvec3"
            | "bvec4"
            | "ivec2"
            | "ivec3"
            | "ivec4"
            | "uvec2"
            | "uvec3"
            | "uvec4"
            | "dvec2"
            | "dvec3"
            | "dvec4"
            | "mat2"
            | "mat3"
            | "mat4"
            | "mat2x2"
            | "mat2x3"
            | "mat2x4"
            | "mat3x2"
            | "mat3x3"
            | "mat3x4"
            | "mat4x2"
            | "mat4x3"
            | "mat4x4"
    ) || name.starts_with("sampler")
        || name.starts_with("isampler")
        || name.starts_with("usampler")
}

fn boolean_constant(tokens: &[GlslToken<'_>], start: usize, end: usize) -> Option<bool> {
    (end == start + 1).then(|| match tokens[start].text {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    })?
}

fn statement_end(tokens: &[GlslToken<'_>], start: usize, end: usize) -> Option<usize> {
    let mut delimiters = Vec::new();
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            ";" if delimiters.is_empty() => return Some(token_index + 1),
            _ => {}
        }
    }
    None
}

fn split_top_level_ranges(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    separator: &str,
) -> Option<Vec<(usize, usize)>> {
    let mut delimiters = Vec::new();
    let mut ranges = Vec::new();
    let mut range_start = start;
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            token if token == separator && delimiters.is_empty() => {
                ranges.push((range_start, token_index));
                range_start = token_index + 1;
            }
            _ => {}
        }
    }
    if !delimiters.is_empty() {
        return None;
    }
    ranges.push((range_start, end));
    Some(ranges)
}

fn top_level_ternary_tokens(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
) -> Option<(usize, usize)> {
    let question = find_top_level_token(tokens, start, end, "?")?;
    let mut nested_ternaries = 0;
    let mut delimiters = Vec::new();
    for token_index in question + 1..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            "?" if delimiters.is_empty() => nested_ternaries += 1,
            ":" if delimiters.is_empty() && nested_ternaries == 0 => {
                return Some((question, token_index));
            }
            ":" if delimiters.is_empty() => nested_ternaries -= 1,
            _ => {}
        }
    }
    None
}

fn find_top_level_token(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
    target: &str,
) -> Option<usize> {
    let mut delimiters = Vec::new();
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            token if token == target && delimiters.is_empty() => return Some(token_index),
            _ => {}
        }
    }
    None
}

fn strip_group_tokens(
    tokens: &[GlslToken<'_>],
    mut start: usize,
    mut end: usize,
) -> (usize, usize) {
    while end > start + 1
        && tokens[start].text == "("
        && matching_token(tokens, start, "(", ")") == Some(end - 1)
    {
        start += 1;
        end -= 1;
    }
    (start, end)
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

fn skip_horizontal_whitespace(bytes: &[u8], mut offset: usize) -> usize {
    while matches!(bytes.get(offset), Some(b' ' | b'\t')) {
        offset += 1;
    }
    offset
}

fn supported_statement(
    next_token_index: usize,
    active_states: FxHashSet<u8>,
    has_unwritten_return: bool,
) -> StatementAnalysis {
    StatementAnalysis {
        next_token_index,
        result: VectorExecutionResult {
            active_states,
            has_unwritten_return,
            is_supported: true,
        },
    }
}

fn unsupported_statement(
    next_token_index: usize,
    active_states: FxHashSet<u8>,
) -> StatementAnalysis {
    StatementAnalysis {
        next_token_index,
        result: VectorExecutionResult {
            active_states,
            has_unwritten_return: false,
            is_supported: false,
        },
    }
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
