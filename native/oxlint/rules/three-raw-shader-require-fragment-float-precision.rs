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

const MESSAGE: &str = "RawShaderMaterial does not receive Three.js precision declarations, and fragment GLSL has no default float precision for this unqualified declaration";
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
pub struct ThreeRawShaderRequireFragmentFloatPrecision;

declare_oxc_lint!(
    /// Require float precision in Three.js raw fragment shaders.
    ThreeRawShaderRequireFragmentFloatPrecision,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Raw fragment shader lacks float precision.",
);

impl Rule for ThreeRawShaderRequireFragmentFloatPrecision {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::NewExpression(new_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &new_expression.callee,
                "RawShaderMaterial",
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
            let Some((fragment_shader, _)) = effective_shader_expressions(options_object) else {
                continue;
            };
            let Some(shader_expression) = fragment_shader else {
                continue;
            };
            let Some(shader_source) =
                resolve_static_shader_source(shader_expression, ctx, &mut FxHashSet::default())
            else {
                continue;
            };
            let Some(declaration_offset) = first_unqualified_float_declaration(&shader_source.text)
            else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::error(MESSAGE)
                    .with_label(shader_source.origin_span(declaration_offset)),
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

fn first_unqualified_float_declaration(source: &str) -> Option<usize> {
    let source_characters = source.chars().collect::<Vec<_>>();
    let mut masked_characters = source_characters.clone();
    let mut character_index = 0;
    let mut is_block_comment = false;
    let mut is_line_comment = false;
    while character_index < source_characters.len() {
        let character = source_characters[character_index];
        let next_character = source_characters.get(character_index + 1).copied();
        if is_line_comment {
            if matches!(character, '\r' | '\n') {
                is_line_comment = false;
            } else {
                masked_characters[character_index] = ' ';
            }
        } else if is_block_comment {
            if character == '*' && next_character == Some('/') {
                masked_characters[character_index] = ' ';
                masked_characters[character_index + 1] = ' ';
                character_index += 1;
                is_block_comment = false;
            } else if !matches!(character, '\r' | '\n') {
                masked_characters[character_index] = ' ';
            }
        } else if character == '/' && next_character == Some('/') {
            masked_characters[character_index] = ' ';
            masked_characters[character_index + 1] = ' ';
            character_index += 1;
            is_line_comment = true;
        } else if character == '/' && next_character == Some('*') {
            masked_characters[character_index] = ' ';
            masked_characters[character_index + 1] = ' ';
            character_index += 1;
            is_block_comment = true;
        }
        character_index += 1;
    }

    if has_conditional_glsl_directive(&masked_characters)
        || !glsl_delimiters_are_balanced(&masked_characters)
    {
        return None;
    }
    mask_preprocessor_lines(&mut masked_characters);
    let tokens = tokenize_glsl(&masked_characters);
    let mut has_default_float_precision = false;
    for token_index in 0..tokens.len() {
        let token = &tokens[token_index];
        if token.text == "precision"
            && tokens
                .get(token_index + 1)
                .is_some_and(|token| matches!(token.text.as_str(), "highp" | "lowp" | "mediump"))
            && tokens
                .get(token_index + 2)
                .is_some_and(|token| token.text == "float")
        {
            has_default_float_precision = true;
            continue;
        }
        if has_default_float_precision || !is_float_type_name(&token.text) {
            continue;
        }
        let declaration_start = tokens[..token_index]
            .iter()
            .rposition(|candidate| matches!(candidate.text.as_str(), "," | "(" | ";" | "{" | "}"))
            .map_or(0, |index| index + 1);
        if tokens[declaration_start..token_index]
            .iter()
            .any(|candidate| matches!(candidate.text.as_str(), "highp" | "lowp" | "mediump"))
        {
            continue;
        }
        if tokens
            .get(token_index + 1)
            .is_some_and(|candidate| candidate.text == "(")
        {
            continue;
        }
        return Some(
            source_characters[..token.character_offset]
                .iter()
                .map(|character| character.len_utf16())
                .sum(),
        );
    }
    None
}

struct GlslToken {
    text: String,
    character_offset: usize,
}

fn tokenize_glsl(source: &[char]) -> Vec<GlslToken> {
    let mut tokens = Vec::new();
    let mut character_index = 0;
    while character_index < source.len() {
        if source[character_index].is_ascii_whitespace() {
            character_index += 1;
            continue;
        }
        let token_start = character_index;
        if source[character_index].is_ascii_alphabetic() || source[character_index] == '_' {
            character_index += 1;
            while source
                .get(character_index)
                .is_some_and(|character| character.is_ascii_alphanumeric() || *character == '_')
            {
                character_index += 1;
            }
        } else {
            character_index += 1;
        }
        tokens.push(GlslToken {
            text: source[token_start..character_index].iter().collect(),
            character_offset: token_start,
        });
    }
    tokens
}

fn mask_preprocessor_lines(source: &mut [char]) {
    let mut line_start = 0;
    let mut continuation = false;
    while line_start <= source.len() {
        let line_end = source[line_start..]
            .iter()
            .position(|character| matches!(character, '\r' | '\n'))
            .map_or(source.len(), |offset| line_start + offset);
        let is_directive = continuation
            || source[line_start..line_end]
                .iter()
                .find(|character| !matches!(character, ' ' | '\t'))
                == Some(&'#');
        continuation = is_directive
            && source[line_start..line_end]
                .iter()
                .rfind(|character| !matches!(character, ' ' | '\t'))
                == Some(&'\\');
        if is_directive {
            source[line_start..line_end].fill(' ');
        }
        if line_end == source.len() {
            break;
        }
        line_start = line_end + 1;
    }
}

fn is_float_type_name(name: &str) -> bool {
    matches!(
        name,
        "float" | "vec2" | "vec3" | "vec4" | "mat2" | "mat3" | "mat4"
    ) || matches!(
        name.as_bytes(),
        [b'm', b'a', b't', b'2'..=b'4', b'x', b'2'..=b'4']
    )
}

fn has_conditional_glsl_directive(source: &[char]) -> bool {
    source
        .split(|character| matches!(character, '\r' | '\n'))
        .any(|line| {
            let mut character_index = line
                .iter()
                .take_while(|character| matches!(character, ' ' | '\t'))
                .count();
            if line.get(character_index) != Some(&'#') {
                return false;
            }
            character_index += 1;
            character_index += line[character_index..]
                .iter()
                .take_while(|character| matches!(character, ' ' | '\t'))
                .count();
            ["if", "ifdef", "ifndef", "elif", "else", "endif"]
                .iter()
                .any(|directive_name| {
                    let directive_length = directive_name.chars().count();
                    line.get(character_index..character_index + directive_length)
                        .is_some_and(|candidate| {
                            candidate.iter().copied().eq(directive_name.chars())
                        })
                        && line
                            .get(character_index + directive_length)
                            .is_none_or(|character| {
                                !character.is_ascii_alphanumeric() && *character != '_'
                            })
                })
        })
}

fn glsl_delimiters_are_balanced(source: &[char]) -> bool {
    let mut delimiters = Vec::new();
    let mut line_start = 0;
    let mut is_directive_continuation = false;
    while line_start <= source.len() {
        let line_end = source[line_start..]
            .iter()
            .position(|character| matches!(character, '\r' | '\n'))
            .map_or(source.len(), |offset| line_start + offset);
        let line = &source[line_start..line_end];
        let is_directive_line = is_directive_continuation
            || line
                .iter()
                .find(|character| !matches!(character, ' ' | '\t'))
                == Some(&'#');
        if !is_directive_line {
            for character in line {
                match character {
                    '(' | '[' | '{' => delimiters.push(*character),
                    ')' if delimiters.pop() != Some('(') => return false,
                    ']' if delimiters.pop() != Some('[') => return false,
                    '}' if delimiters.pop() != Some('{') => return false,
                    _ => {}
                }
            }
        }
        is_directive_continuation = is_directive_line
            && line
                .iter()
                .rfind(|character| !matches!(character, ' ' | '\t'))
                == Some(&'\\');
        if line_end == source.len() {
            break;
        }
        line_start = if source[line_end] == '\r' && source.get(line_end + 1) == Some(&'\n') {
            line_end + 2
        } else {
            line_end + 1
        };
    }
    delimiters.is_empty()
}
