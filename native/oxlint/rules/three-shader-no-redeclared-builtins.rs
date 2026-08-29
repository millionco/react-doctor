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

const FRAGMENT_INJECTED_NAMES: [&str; 3] = ["cameraPosition", "isOrthographic", "viewMatrix"];
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
const VERTEX_INJECTED_NAMES: [&str; 10] = [
    "cameraPosition",
    "isOrthographic",
    "modelMatrix",
    "modelViewMatrix",
    "normal",
    "normalMatrix",
    "position",
    "projectionMatrix",
    "uv",
    "viewMatrix",
];

#[derive(Debug, Default, Clone)]
pub struct ThreeShaderNoRedeclaredBuiltins;

declare_oxc_lint!(
    /// Disallow ShaderMaterial declarations that collide with Three.js injected names.
    ThreeShaderNoRedeclaredBuiltins,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "ShaderMaterial redeclares a Three.js builtin.",
);

impl Rule for ThreeShaderNoRedeclaredBuiltins {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::NewExpression(new_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &new_expression.callee,
                "ShaderMaterial",
                &THREE_MODULE_SOURCES,
                &property_write_analysis,
                ctx,
            ) {
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
            if let Some(vertex_shader) = vertex_shader
                && let Some(shader_source) =
                    resolve_static_shader_source(vertex_shader, ctx, &mut FxHashSet::default())
            {
                report_redeclared_builtins(&shader_source, "vertex", &VERTEX_INJECTED_NAMES, ctx);
            }
            if let Some(fragment_shader) = fragment_shader
                && let Some(shader_source) =
                    resolve_static_shader_source(fragment_shader, ctx, &mut FxHashSet::default())
            {
                report_redeclared_builtins(
                    &shader_source,
                    "fragment",
                    &FRAGMENT_INJECTED_NAMES,
                    ctx,
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

struct GlslBuiltinDeclaration {
    byte_offset: usize,
    name: &'static str,
}

fn report_redeclared_builtins(
    shader_source: &StaticShaderSource,
    stage: &str,
    injected_names: &[&'static str],
    ctx: &LintContext<'_>,
) {
    for declaration in glsl_builtin_declarations(&shader_source.text, injected_names) {
        let message = format!(
            "ShaderMaterial already injects {} into the {stage} shader, so this declaration collides with Three.js's generated prefix",
            declaration.name
        );
        let utf16_offset = shader_source.text[..declaration.byte_offset]
            .encode_utf16()
            .count();
        ctx.diagnostic(
            OxcDiagnostic::error(message).with_label(shader_source.origin_span(utf16_offset)),
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

fn glsl_builtin_declarations(
    source: &str,
    injected_names: &[&'static str],
) -> Vec<GlslBuiltinDeclaration> {
    let Some(masked_source) = mask_glsl_comments(source) else {
        return Vec::new();
    };
    if has_conditional_glsl_directive(&masked_source) {
        return Vec::new();
    }
    let Some(masked_source) = mask_glsl_preprocessor_directives(masked_source) else {
        return Vec::new();
    };
    if !glsl_delimiters_are_balanced(&masked_source) {
        return Vec::new();
    }
    let bytes = masked_source.as_bytes();
    let mut declarations = Vec::new();
    let mut brace_depth = 0;
    let mut parenthesis_depth = 0;
    let mut bracket_depth = 0;
    let mut is_struct_declaration_brace = false;
    let mut statement_start = 0;
    for (byte_offset, byte) in bytes.iter().copied().enumerate() {
        match byte {
            b'{' => {
                if brace_depth == 0 {
                    is_struct_declaration_brace =
                        source_prefix_declares_struct(&masked_source[statement_start..byte_offset]);
                }
                brace_depth += 1;
            }
            b'}' => {
                brace_depth -= 1;
                if brace_depth == 0 && !is_struct_declaration_brace {
                    statement_start = byte_offset + 1;
                    parenthesis_depth = 0;
                    bracket_depth = 0;
                }
                if brace_depth == 0 {
                    is_struct_declaration_brace = false;
                }
            }
            b'(' if brace_depth == 0 => parenthesis_depth += 1,
            b')' if brace_depth == 0 => parenthesis_depth -= 1,
            b'[' if brace_depth == 0 => bracket_depth += 1,
            b']' if brace_depth == 0 => bracket_depth -= 1,
            b';' if brace_depth == 0 && parenthesis_depth == 0 && bracket_depth == 0 => {
                collect_builtin_declarations_in_statement(
                    &masked_source,
                    statement_start,
                    byte_offset,
                    injected_names,
                    &mut declarations,
                );
                statement_start = byte_offset + 1;
            }
            _ => {}
        }
    }
    declarations
}

fn collect_builtin_declarations_in_statement(
    source: &str,
    statement_start: usize,
    statement_end: usize,
    injected_names: &[&'static str],
    declarations: &mut Vec<GlslBuiltinDeclaration>,
) {
    let statement = &source[statement_start..statement_end];
    let Some(first_token_offset) = statement
        .iter_identifier_tokens()
        .next()
        .map(|token| token.0)
    else {
        return;
    };
    let first_token_end = statement.as_bytes()[first_token_offset..]
        .iter()
        .position(|byte| !is_identifier_byte(*byte))
        .map_or(statement.len(), |offset| first_token_offset + offset);
    if matches!(
        &statement[first_token_offset..first_token_end],
        "invariant" | "precise" | "precision"
    ) {
        return;
    }
    for injected_name in injected_names.iter().copied() {
        let mut search_offset = 0;
        while search_offset + injected_name.len() <= statement.len() {
            let Some(relative_offset) = statement[search_offset..].find(injected_name) else {
                break;
            };
            let name_offset = search_offset + relative_offset;
            let name_end = name_offset + injected_name.len();
            search_offset = name_end;
            if !is_identifier_boundary(
                statement
                    .as_bytes()
                    .get(name_offset.wrapping_sub(1))
                    .copied(),
            ) || !is_identifier_boundary(statement.as_bytes().get(name_end).copied())
                || !is_glsl_declarator_identifier(statement, name_offset, name_end)
            {
                continue;
            }
            let declaration_offset = if has_top_level_comma_before(statement, name_offset) {
                statement_start + name_offset
            } else {
                statement_start
                    + statement
                        .as_bytes()
                        .iter()
                        .position(|byte| !byte.is_ascii_whitespace())
                        .unwrap_or(name_offset)
            };
            declarations.push(GlslBuiltinDeclaration {
                byte_offset: declaration_offset,
                name: injected_name,
            });
        }
    }
    declarations.sort_unstable_by_key(|declaration| declaration.byte_offset);
}

fn is_glsl_declarator_identifier(statement: &str, name_offset: usize, name_end: usize) -> bool {
    let bytes = statement.as_bytes();
    let following_offset = skip_ascii_whitespace(bytes, name_end);
    if !name_is_at_top_level(statement, name_offset)
        || !matches!(bytes.get(following_offset), None | Some(b'[' | b'=' | b','))
    {
        return false;
    }
    if previous_non_whitespace_byte(bytes, name_offset) == Some(b'.') {
        return false;
    }
    let segment_start = last_top_level_comma_before(statement, name_offset)
        .map_or(0, |comma_offset| comma_offset + 1);
    if has_top_level_assignment(&statement[segment_start..name_offset]) {
        return false;
    }
    let has_identifier_before = statement[segment_start..name_offset]
        .iter_identifier_tokens()
        .next()
        .is_some();
    if segment_start > 0 {
        return !has_identifier_before;
    }
    has_identifier_before
}

fn name_is_at_top_level(source: &str, offset: usize) -> bool {
    let mut brace_depth = 0;
    let mut parenthesis_depth = 0;
    let mut bracket_depth = 0;
    for byte in source.as_bytes()[..offset].iter().copied() {
        match byte {
            b'{' => brace_depth += 1,
            b'}' => brace_depth -= 1,
            b'(' => parenthesis_depth += 1,
            b')' => parenthesis_depth -= 1,
            b'[' => bracket_depth += 1,
            b']' => bracket_depth -= 1,
            _ => {}
        }
    }
    brace_depth == 0 && parenthesis_depth == 0 && bracket_depth == 0
}

fn has_top_level_comma_before(source: &str, offset: usize) -> bool {
    last_top_level_comma_before(source, offset).is_some()
}

fn last_top_level_comma_before(source: &str, offset: usize) -> Option<usize> {
    let mut brace_depth = 0;
    let mut parenthesis_depth = 0;
    let mut bracket_depth = 0;
    let mut last_comma = None;
    for (byte_offset, byte) in source.as_bytes()[..offset].iter().copied().enumerate() {
        match byte {
            b'{' => brace_depth += 1,
            b'}' => brace_depth -= 1,
            b'(' => parenthesis_depth += 1,
            b')' => parenthesis_depth -= 1,
            b'[' => bracket_depth += 1,
            b']' => bracket_depth -= 1,
            b',' if brace_depth == 0 && parenthesis_depth == 0 && bracket_depth == 0 => {
                last_comma = Some(byte_offset);
            }
            _ => {}
        }
    }
    last_comma
}

fn has_top_level_assignment(source: &str) -> bool {
    let mut brace_depth = 0;
    let mut parenthesis_depth = 0;
    let mut bracket_depth = 0;
    for byte in source.bytes() {
        match byte {
            b'{' => brace_depth += 1,
            b'}' => brace_depth -= 1,
            b'(' => parenthesis_depth += 1,
            b')' => parenthesis_depth -= 1,
            b'[' => bracket_depth += 1,
            b']' => bracket_depth -= 1,
            b'=' if brace_depth == 0 && parenthesis_depth == 0 && bracket_depth == 0 => {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn source_prefix_declares_struct(source: &str) -> bool {
    source
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|token| token == "struct")
}

trait IdentifierTokens {
    fn iter_identifier_tokens(&self) -> IdentifierTokenIterator<'_>;
}

impl IdentifierTokens for str {
    fn iter_identifier_tokens(&self) -> IdentifierTokenIterator<'_> {
        IdentifierTokenIterator {
            bytes: self.as_bytes(),
            offset: 0,
        }
    }
}

struct IdentifierTokenIterator<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl Iterator for IdentifierTokenIterator<'_> {
    type Item = (usize, usize);

    fn next(&mut self) -> Option<Self::Item> {
        while self
            .bytes
            .get(self.offset)
            .is_some_and(|byte| !is_identifier_start_byte(*byte))
        {
            self.offset += 1;
        }
        let start = self.offset;
        if start == self.bytes.len() {
            return None;
        }
        self.offset += 1;
        while self
            .bytes
            .get(self.offset)
            .is_some_and(|byte| is_identifier_byte(*byte))
        {
            self.offset += 1;
        }
        Some((start, self.offset))
    }
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

fn line_has_glsl_directive(line: &[u8], directive_names: &[&str]) -> bool {
    let mut offset = skip_horizontal_whitespace(line, 0);
    if line.get(offset) != Some(&b'#') {
        return false;
    }
    offset = skip_horizontal_whitespace(line, offset + 1);
    directive_names.iter().any(|directive_name| {
        let word_bytes = directive_name.as_bytes();
        line.get(offset..offset + word_bytes.len()) == Some(word_bytes)
            && line
                .get(offset + word_bytes.len())
                .is_none_or(|byte| !is_identifier_byte(*byte))
    })
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
