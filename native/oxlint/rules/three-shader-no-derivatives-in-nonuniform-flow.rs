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
pub struct ThreeShaderNoDerivativesInNonuniformFlow;

declare_oxc_lint!(
    /// Disallow derivative operations in fragment-input-dependent control flow.
    ThreeShaderNoDerivativesInNonuniformFlow,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Shader derivative runs in non-uniform control flow.",
);

impl Rule for ThreeShaderNoDerivativesInNonuniformFlow {
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
            for derivative_call in derivative_calls_in_nonuniform_flow(&shader_source.text) {
                let utf16_offset = shader_source.text[..derivative_call.byte_offset]
                    .encode_utf16()
                    .count();
                let message = format!(
                    "{} executes only on fragment-input-dependent lanes, so implicit derivatives are undefined. Move it before the divergent branch or use explicit gradients",
                    derivative_call.function_name
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

const DERIVATIVE_FUNCTION_NAMES: [&str; 3] = ["dFdx", "dFdy", "fwidth"];
const IMPLICIT_DERIVATIVE_TEXTURE_FUNCTION_NAMES: [&str; 9] = [
    "texture",
    "texture2D",
    "texture2DProj",
    "texture3D",
    "texture3DProj",
    "textureCube",
    "textureOffset",
    "textureProj",
    "textureProjOffset",
];
const FRAGMENT_INPUT_BUILTIN_NAMES: [&str; 10] = [
    "gl_FragCoord",
    "gl_FrontFacing",
    "gl_HelperInvocation",
    "gl_Layer",
    "gl_PointCoord",
    "gl_PrimitiveID",
    "gl_SampleID",
    "gl_SampleMaskIn",
    "gl_SamplePosition",
    "gl_ViewportIndex",
];

struct DerivativeCall {
    byte_offset: usize,
    function_name: String,
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
    parameter_close_token_index: usize,
    parameter_open_token_index: usize,
}

fn derivative_calls_in_nonuniform_flow(source: &str) -> Vec<DerivativeCall> {
    let source_without_comments = mask_glsl_comments(source);
    if has_glsl_directive(
        &source_without_comments,
        &["if", "ifdef", "ifndef", "elif", "else", "endif"],
    ) {
        return Vec::new();
    }
    let source_for_tokens = mask_glsl_preprocessor_directives(&source_without_comments);
    let Some(tokens) = tokenize_glsl(&source_for_tokens) else {
        return Vec::new();
    };
    let Some(functions) = collect_glsl_functions(&tokens) else {
        return Vec::new();
    };
    let global_inputs = collect_global_fragment_inputs(&tokens);
    let declared_function_names = functions
        .iter()
        .map(|function| tokens[function.name_token_index].text)
        .collect::<FxHashSet<_>>();
    let suppressed_function_names = DERIVATIVE_FUNCTION_NAMES
        .iter()
        .chain(IMPLICIT_DERIVATIVE_TEXTURE_FUNCTION_NAMES.iter())
        .copied()
        .filter(|function_name| {
            declared_function_names.contains(function_name)
                || has_glsl_function_like_macro(&source_without_comments, function_name)
        })
        .collect::<FxHashSet<_>>();
    let mut calls = Vec::new();
    for function in functions
        .iter()
        .filter(|function| function.body_open_token_index < function.body_close_token_index)
    {
        let mut scopes = vec![collect_parameter_names(
            &tokens,
            function.parameter_open_token_index + 1,
            function.parameter_close_token_index,
        )];
        scopes.push(FxHashSet::default());
        if analyze_compound(
            &tokens,
            function.body_open_token_index + 1,
            function.body_close_token_index,
            false,
            &global_inputs,
            &suppressed_function_names,
            &mut scopes,
            &mut calls,
        )
        .is_none()
        {
            return Vec::new();
        }
    }
    calls.sort_by_key(|call| call.byte_offset);
    calls
}

fn collect_global_fragment_inputs<'a>(tokens: &[GlslToken<'a>]) -> FxHashSet<&'a str> {
    let mut inputs = FxHashSet::default();
    let mut brace_depth = 0usize;
    let mut statement_start = 0;
    for token_index in 0..tokens.len() {
        match tokens[token_index].text {
            "{" => brace_depth += 1,
            "}" => {
                brace_depth = brace_depth.saturating_sub(1);
                if brace_depth == 0 {
                    statement_start = token_index + 1;
                }
            }
            ";" if brace_depth == 0 => {
                collect_fragment_input_names_from_statement(
                    tokens,
                    statement_start,
                    token_index,
                    &mut inputs,
                );
                statement_start = token_index + 1;
            }
            _ => {}
        }
    }
    inputs
}

fn collect_fragment_input_names_from_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    inputs: &mut FxHashSet<&'a str>,
) {
    if tokens[start..end].iter().any(|token| token.text == "{") {
        return;
    }
    let mut delimiters = Vec::new();
    let qualifier_index = (start..end).find(|token_index| {
        match tokens[*token_index].text {
            "(" | "[" => delimiters.push(tokens[*token_index].text),
            ")" | "]" => {
                delimiters.pop();
            }
            _ => {}
        }
        delimiters.is_empty() && matches!(tokens[*token_index].text, "in" | "varying")
    });
    let Some(qualifier_index) = qualifier_index else {
        return;
    };
    let mut token_index = qualifier_index + 1;
    while token_index < end
        && matches!(
            tokens[token_index].text,
            "centroid"
                | "flat"
                | "smooth"
                | "noperspective"
                | "sample"
                | "highp"
                | "mediump"
                | "lowp"
                | "precise"
        )
    {
        token_index += 1;
    }
    if tokens.get(token_index).map(|token| token.kind) != Some(GlslTokenKind::Identifier) {
        return;
    }
    token_index += 1;
    while tokens.get(token_index).map(|token| token.text) == Some("[") {
        let Some(close) = matching_token(tokens, token_index, "[", "]") else {
            return;
        };
        token_index = close + 1;
    }
    while token_index < end {
        if tokens[token_index].kind == GlslTokenKind::Identifier {
            inputs.insert(tokens[token_index].text);
            token_index = skip_declarator(tokens, token_index + 1, end);
        } else {
            token_index += 1;
        }
        while token_index < end && tokens[token_index].text != "," {
            token_index += 1;
        }
        token_index += usize::from(token_index < end);
    }
}

fn skip_declarator(tokens: &[GlslToken<'_>], mut token_index: usize, end: usize) -> usize {
    let mut delimiters = Vec::new();
    while token_index < end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return end,
            "]" if delimiters.pop() != Some("[") => return end,
            "}" if delimiters.pop() != Some("{") => return end,
            "," if delimiters.is_empty() => break,
            _ => {}
        }
        token_index += 1;
    }
    token_index
}

fn collect_parameter_names<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
) -> FxHashSet<&'a str> {
    let mut names = FxHashSet::default();
    let Some(ranges) = split_top_level_ranges(tokens, start, end, ",") else {
        return names;
    };
    for (range_start, range_end) in ranges {
        let identifiers = tokens[range_start..range_end]
            .iter()
            .filter(|token| token.kind == GlslTokenKind::Identifier)
            .collect::<Vec<_>>();
        if identifiers.len() >= 2
            && let Some(identifier) = identifiers.last()
        {
            names.insert(identifier.text);
        }
    }
    names
}

fn analyze_compound<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<()> {
    let mut token_index = start;
    while token_index < end {
        if tokens[token_index].text == ";" {
            token_index += 1;
            continue;
        }
        if matches!(tokens[token_index].text, "case" | "default") {
            let colon = case_label_colon(tokens, token_index + 1, end)?;
            analyze_expression(
                tokens,
                token_index + 1,
                colon,
                is_nonuniform,
                global_inputs,
                suppressed_function_names,
                scopes,
                calls,
            )?;
            token_index = colon + 1;
            continue;
        }
        token_index = analyze_statement(
            tokens,
            token_index,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        )?;
    }
    Some(())
}

fn case_label_colon(tokens: &[GlslToken<'_>], start: usize, end: usize) -> Option<usize> {
    let mut delimiters = Vec::new();
    let mut ternary_depth = 0;
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            "?" if delimiters.is_empty() => ternary_depth += 1,
            ":" if delimiters.is_empty() && ternary_depth > 0 => ternary_depth -= 1,
            ":" if delimiters.is_empty() => return Some(token_index),
            _ => {}
        }
    }
    None
}

fn analyze_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    match tokens.get(start)?.text {
        "{" => {
            let close = matching_token(tokens, start, "{", "}")?;
            scopes.push(FxHashSet::default());
            analyze_compound(
                tokens,
                start + 1,
                close,
                is_nonuniform,
                global_inputs,
                suppressed_function_names,
                scopes,
                calls,
            )?;
            scopes.pop();
            Some(close + 1)
        }
        "if" => analyze_if_statement(
            tokens,
            start,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        ),
        "while" => analyze_while_statement(
            tokens,
            start,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        ),
        "do" => analyze_do_statement(
            tokens,
            start,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        ),
        "for" => analyze_for_statement(
            tokens,
            start,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        ),
        "switch" => analyze_switch_statement(
            tokens,
            start,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        ),
        _ => analyze_simple_statement(
            tokens,
            start,
            end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        ),
    }
}

fn analyze_scoped_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    scopes.push(FxHashSet::default());
    let next = analyze_statement(
        tokens,
        start,
        end,
        is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    );
    scopes.pop();
    next
}

fn analyze_if_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    let condition_open = start + 1;
    let condition_close = matching_token(tokens, condition_open, "(", ")")?;
    analyze_expression(
        tokens,
        condition_open + 1,
        condition_close,
        is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    let branch_is_nonuniform = is_nonuniform
        || expression_depends_on_fragment_input(
            tokens,
            condition_open + 1,
            condition_close,
            global_inputs,
            scopes,
        );
    let consequent_end = analyze_scoped_statement(
        tokens,
        condition_close + 1,
        end,
        branch_is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    if tokens.get(consequent_end).map(|token| token.text) != Some("else") {
        return Some(consequent_end);
    }
    analyze_scoped_statement(
        tokens,
        consequent_end + 1,
        end,
        branch_is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )
}

fn analyze_while_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    let condition_open = start + 1;
    let condition_close = matching_token(tokens, condition_open, "(", ")")?;
    analyze_expression(
        tokens,
        condition_open + 1,
        condition_close,
        is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    let body_is_nonuniform = is_nonuniform
        || expression_depends_on_fragment_input(
            tokens,
            condition_open + 1,
            condition_close,
            global_inputs,
            scopes,
        );
    analyze_scoped_statement(
        tokens,
        condition_close + 1,
        end,
        body_is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )
}

fn analyze_do_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    let body_start = start + 1;
    let body_end = statement_extent(tokens, body_start, end)?;
    if tokens.get(body_end).map(|token| token.text) != Some("while") {
        return None;
    }
    let condition_open = body_end + 1;
    let condition_close = matching_token(tokens, condition_open, "(", ")")?;
    analyze_expression(
        tokens,
        condition_open + 1,
        condition_close,
        is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    let body_is_nonuniform = is_nonuniform
        || expression_depends_on_fragment_input(
            tokens,
            condition_open + 1,
            condition_close,
            global_inputs,
            scopes,
        );
    analyze_scoped_statement(
        tokens,
        body_start,
        body_end,
        body_is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    (tokens.get(condition_close + 1).map(|token| token.text) == Some(";"))
        .then_some(condition_close + 2)
}

fn analyze_for_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    let control_open = start + 1;
    let control_close = matching_token(tokens, control_open, "(", ")")?;
    let control_ranges = split_top_level_ranges(tokens, control_open + 1, control_close, ";")?;
    if control_ranges.len() != 3 {
        return None;
    }
    scopes.push(FxHashSet::default());
    for declaration_name in declaration_names(tokens, control_ranges[0].0, control_ranges[0].1) {
        scopes.last_mut()?.insert(declaration_name);
    }
    let has_condition = control_ranges[1].0 < control_ranges[1].1;
    let mut body_is_nonuniform = is_nonuniform;
    for (range_start, range_end) in control_ranges {
        analyze_expression(
            tokens,
            range_start,
            range_end,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        )?;
        if has_condition {
            body_is_nonuniform |= expression_depends_on_fragment_input(
                tokens,
                range_start,
                range_end,
                global_inputs,
                scopes,
            );
        }
    }
    let next = analyze_scoped_statement(
        tokens,
        control_close + 1,
        end,
        body_is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    );
    scopes.pop();
    next
}

fn analyze_switch_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    let expression_open = start + 1;
    let expression_close = matching_token(tokens, expression_open, "(", ")")?;
    analyze_expression(
        tokens,
        expression_open + 1,
        expression_close,
        is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    let cases_are_nonuniform = is_nonuniform
        || expression_depends_on_fragment_input(
            tokens,
            expression_open + 1,
            expression_close,
            global_inputs,
            scopes,
        );
    analyze_scoped_statement(
        tokens,
        expression_close + 1,
        end,
        cases_are_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )
}

fn analyze_simple_statement<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &mut Vec<FxHashSet<&'a str>>,
    calls: &mut Vec<DerivativeCall>,
) -> Option<usize> {
    let next = statement_end(tokens, start, end)?;
    analyze_expression(
        tokens,
        start,
        next - 1,
        is_nonuniform,
        global_inputs,
        suppressed_function_names,
        scopes,
        calls,
    )?;
    for declaration_name in declaration_names(tokens, start, next - 1) {
        scopes.last_mut()?.insert(declaration_name);
    }
    Some(next)
}

fn analyze_expression<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    is_nonuniform: bool,
    global_inputs: &FxHashSet<&'a str>,
    suppressed_function_names: &FxHashSet<&'a str>,
    scopes: &[FxHashSet<&'a str>],
    calls: &mut Vec<DerivativeCall>,
) -> Option<()> {
    if start >= end {
        return Some(());
    }
    if let Some((question, colon)) = top_level_ternary_tokens(tokens, start, end) {
        analyze_expression(
            tokens,
            start,
            question,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        )?;
        let branch_is_nonuniform = is_nonuniform
            || expression_depends_on_fragment_input(tokens, start, question, global_inputs, scopes);
        analyze_expression(
            tokens,
            question + 1,
            colon,
            branch_is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        )?;
        return analyze_expression(
            tokens,
            colon + 1,
            end,
            branch_is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        );
    }
    if let Some(operator_index) = find_last_top_level_short_circuit(tokens, start, end) {
        analyze_expression(
            tokens,
            start,
            operator_index,
            is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        )?;
        let right_is_nonuniform = is_nonuniform
            || expression_depends_on_fragment_input(
                tokens,
                start,
                operator_index,
                global_inputs,
                scopes,
            );
        return analyze_expression(
            tokens,
            operator_index + 1,
            end,
            right_is_nonuniform,
            global_inputs,
            suppressed_function_names,
            scopes,
            calls,
        );
    }
    let mut token_index = start;
    while token_index < end {
        if tokens[token_index].kind == GlslTokenKind::Identifier
            && tokens.get(token_index + 1).map(|token| token.text) == Some("(")
        {
            let close = matching_token(tokens, token_index + 1, "(", ")")?;
            if close >= end {
                return None;
            }
            if is_nonuniform
                && is_derivative_function_name(tokens[token_index].text)
                && !suppressed_function_names.contains(tokens[token_index].text)
                && (token_index == start || tokens[token_index - 1].text != ".")
            {
                calls.push(DerivativeCall {
                    byte_offset: tokens[token_index].start,
                    function_name: tokens[token_index].text.to_string(),
                });
            }
            analyze_expression(
                tokens,
                token_index + 2,
                close,
                is_nonuniform,
                global_inputs,
                suppressed_function_names,
                scopes,
                calls,
            )?;
            token_index = close + 1;
            continue;
        }
        if matches!(tokens[token_index].text, "(" | "[") {
            let closing = if tokens[token_index].text == "(" {
                ")"
            } else {
                "]"
            };
            let close = matching_token(tokens, token_index, tokens[token_index].text, closing)?;
            if close >= end {
                return None;
            }
            analyze_expression(
                tokens,
                token_index + 1,
                close,
                is_nonuniform,
                global_inputs,
                suppressed_function_names,
                scopes,
                calls,
            )?;
            token_index = close + 1;
            continue;
        }
        token_index += 1;
    }
    Some(())
}

fn expression_depends_on_fragment_input<'a>(
    tokens: &[GlslToken<'a>],
    start: usize,
    end: usize,
    global_inputs: &FxHashSet<&'a str>,
    scopes: &[FxHashSet<&'a str>],
) -> bool {
    (start..end).any(|token_index| {
        let token = tokens[token_index];
        if token.kind != GlslTokenKind::Identifier
            || (token_index > start && tokens[token_index - 1].text == ".")
            || tokens.get(token_index + 1).map(|token| token.text) == Some("(")
        {
            return false;
        }
        FRAGMENT_INPUT_BUILTIN_NAMES.contains(&token.text)
            || (global_inputs.contains(token.text)
                && !scopes.iter().rev().any(|scope| scope.contains(token.text)))
    })
}

fn declaration_names<'a>(tokens: &[GlslToken<'a>], start: usize, end: usize) -> Vec<&'a str> {
    if start >= end
        || matches!(
            tokens[start].text,
            "return" | "discard" | "break" | "continue"
        )
    {
        return Vec::new();
    }
    let mut type_index = start;
    while type_index < end
        && matches!(
            tokens[type_index].text,
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
                | "sample"
                | "highp"
                | "mediump"
                | "lowp"
                | "precision"
                | "invariant"
                | "precise"
        )
    {
        type_index += 1;
    }
    if tokens.get(type_index).map(|token| token.kind) != Some(GlslTokenKind::Identifier)
        || tokens.get(type_index + 1).map(|token| token.kind) != Some(GlslTokenKind::Identifier)
    {
        return Vec::new();
    }
    let mut names = Vec::new();
    let mut declarator_start = type_index + 1;
    while declarator_start < end {
        if tokens[declarator_start].kind != GlslTokenKind::Identifier {
            return Vec::new();
        }
        names.push(tokens[declarator_start].text);
        let next = skip_declarator(tokens, declarator_start + 1, end);
        if next >= end {
            break;
        }
        declarator_start = next + 1;
    }
    names
}

fn is_derivative_function_name(name: &str) -> bool {
    DERIVATIVE_FUNCTION_NAMES.contains(&name)
        || IMPLICIT_DERIVATIVE_TEXTURE_FUNCTION_NAMES.contains(&name)
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

fn mask_glsl_preprocessor_directives(source: &str) -> String {
    let mut bytes = source.as_bytes().to_vec();
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
            while bytes
                .get(byte_offset)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'.')
            {
                byte_offset += 1;
            }
            if matches!(bytes.get(byte_offset), Some(b'+' | b'-'))
                && matches!(bytes.get(byte_offset.wrapping_sub(1)), Some(b'e' | b'E'))
            {
                byte_offset += 1;
                while bytes.get(byte_offset).is_some_and(u8::is_ascii_digit) {
                    byte_offset += 1;
                }
            }
            tokens.push(GlslToken {
                kind: GlslTokenKind::Symbol,
                text: &source[token_start..byte_offset],
                start: token_start,
            });
            continue;
        }
        if !bytes[byte_offset].is_ascii() || matches!(bytes[byte_offset], b'\'' | b'"') {
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
        tokens.push(GlslToken {
            kind: GlslTokenKind::Symbol,
            text: &source[token_start..byte_offset],
            start: token_start,
        });
    }
    delimiters_are_balanced(&tokens).then_some(tokens)
}

fn collect_glsl_functions(tokens: &[GlslToken<'_>]) -> Option<Vec<GlslFunction>> {
    let mut functions = Vec::new();
    let mut brace_depth = 0usize;
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
        let parameter_open = token_index + 1;
        let parameter_close = matching_token(tokens, parameter_open, "(", ")")?;
        let following = tokens.get(parameter_close + 1).map(|token| token.text);
        if following == Some("{") {
            let body_open = parameter_close + 1;
            let body_close = matching_token(tokens, body_open, "{", "}")?;
            functions.push(GlslFunction {
                body_close_token_index: body_close,
                body_open_token_index: body_open,
                name_token_index: token_index,
                parameter_close_token_index: parameter_close,
                parameter_open_token_index: parameter_open,
            });
            token_index = body_close + 1;
        } else if following == Some(";") {
            functions.push(GlslFunction {
                body_close_token_index: parameter_close,
                body_open_token_index: parameter_close,
                name_token_index: token_index,
                parameter_close_token_index: parameter_close,
                parameter_open_token_index: parameter_open,
            });
            token_index = parameter_close + 2;
        } else {
            token_index += 1;
        }
    }
    Some(functions)
}

fn statement_extent(tokens: &[GlslToken<'_>], start: usize, end: usize) -> Option<usize> {
    match tokens.get(start)?.text {
        "{" => matching_token(tokens, start, "{", "}").map(|close| close + 1),
        "if" => {
            let condition_close = matching_token(tokens, start + 1, "(", ")")?;
            let consequent_end = statement_extent(tokens, condition_close + 1, end)?;
            if tokens.get(consequent_end).map(|token| token.text) == Some("else") {
                statement_extent(tokens, consequent_end + 1, end)
            } else {
                Some(consequent_end)
            }
        }
        "while" | "for" | "switch" => {
            let control_close = matching_token(tokens, start + 1, "(", ")")?;
            statement_extent(tokens, control_close + 1, end)
        }
        "do" => {
            let body_end = statement_extent(tokens, start + 1, end)?;
            let condition_close = matching_token(tokens, body_end + 1, "(", ")")?;
            (tokens.get(condition_close + 1).map(|token| token.text) == Some(";"))
                .then_some(condition_close + 2)
        }
        _ => statement_end(tokens, start, end),
    }
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
    let mut delimiters = Vec::new();
    let mut question = None;
    let mut nested_ternaries = 0;
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            "?" if delimiters.is_empty() && question.is_none() => question = Some(token_index),
            "?" if delimiters.is_empty() => nested_ternaries += 1,
            ":" if delimiters.is_empty() && question.is_some() && nested_ternaries == 0 => {
                return Some((question?, token_index));
            }
            ":" if delimiters.is_empty() && question.is_some() => nested_ternaries -= 1,
            _ => {}
        }
    }
    None
}

fn find_last_top_level_short_circuit(
    tokens: &[GlslToken<'_>],
    start: usize,
    end: usize,
) -> Option<usize> {
    let mut delimiters = Vec::new();
    let mut found = None;
    for token_index in start..end {
        match tokens[token_index].text {
            "(" | "[" | "{" => delimiters.push(tokens[token_index].text),
            ")" if delimiters.pop() != Some("(") => return None,
            "]" if delimiters.pop() != Some("[") => return None,
            "}" if delimiters.pop() != Some("{") => return None,
            "&&" | "||" if delimiters.is_empty() => found = Some(token_index),
            _ => {}
        }
    }
    found
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

fn has_glsl_function_like_macro(source: &str, function_name: &str) -> bool {
    source.lines().any(|line| {
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

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
