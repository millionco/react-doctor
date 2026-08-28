use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "The WebGPU root exposes state.gl only as a deprecated compatibility alias, which can be mistaken for a WebGLRenderer. Read state.renderer instead";
const DESTRUCTURE_MESSAGE: &str = "The WebGPU root exposes state.gl only as a deprecated compatibility alias, which can be mistaken for a WebGLRenderer. Destructure renderer instead";
const R3F_WEBGPU_MODULES: [&str; 1] = ["@react-three/fiber/webgpu"];

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuNoGlState;

impl RuleMeta for R3FWebgpuNoGlState {
    const NAME: &'static str = "r3f-webgpu-no-gl-state";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Avoid deprecated gl state in R3F WebGPU roots.",
    };
}

impl Rule for R3FWebgpuNoGlState {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut node_index = None;
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            if let Some(object) = r3f_webgpu_gl_member_object(node) {
                if r3f_webgpu_is_use_three_result(object, &analysis, ctx, &mut Vec::new()) {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
                }
                continue;
            }
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    let is_use_three =
                        r3f_webgpu_api_call_matches(call_expression, "useThree", &analysis, ctx);
                    let is_use_frame =
                        r3f_webgpu_api_call_matches(call_expression, "useFrame", &analysis, ctx);
                    if !is_use_three && !is_use_frame {
                        continue;
                    }
                    let Some(callback_expression) = call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                    else {
                        continue;
                    };
                    let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                        callback_expression,
                        &analysis,
                        ctx,
                        &mut resolution_cache,
                    ) else {
                        continue;
                    };
                    let node_index = node_index.get_or_insert_with(|| {
                        build_local_callback_nearest_function_node_index(ctx)
                    });
                    if let Some(gl_read_span) =
                        r3f_webgpu_find_callback_gl_read(callback_id, node_index, ctx)
                    {
                        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(gl_read_span));
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(initializer) = declarator.init.as_ref() else {
                        continue;
                    };
                    if !r3f_webgpu_is_use_three_result(initializer, &analysis, ctx, &mut Vec::new())
                    {
                        continue;
                    }
                    let Some(gl_property) = r3f_webgpu_find_gl_property(&declarator.id) else {
                        continue;
                    };
                    ctx.diagnostic(
                        OxcDiagnostic::warn(DESTRUCTURE_MESSAGE).with_label(gl_property.span()),
                    );
                }
                _ => {}
            }
        }
    }
}

fn r3f_webgpu_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(
        &call_expression.callee,
        api_name,
        &R3F_WEBGPU_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        &call_expression.callee,
        api_name,
        &R3F_WEBGPU_MODULES,
        analysis,
        ctx,
    )
}

fn r3f_webgpu_gl_member_object<'a>(node: &AstNode<'a>) -> Option<&'a Expression<'a>> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) if member.property.name == "gl" => {
            Some(&member.object)
        }
        AstKind::ComputedMemberExpression(member)
            if matches!(
                member.expression.get_inner_expression(),
                Expression::StringLiteral(literal) if literal.value == "gl"
            ) || matches!(
                member.expression.get_inner_expression(),
                Expression::TemplateLiteral(template)
                    if template.expressions.is_empty()
                        && template.quasis.first().is_some_and(|quasi| {
                            quasi.value.cooked.as_ref().map_or(
                                quasi.value.raw.as_str(),
                                |cooked| cooked.as_str(),
                            ) == "gl"
                        })
            ) =>
        {
            Some(&member.object)
        }
        _ => None,
    }
}

fn r3f_webgpu_is_use_three_result<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression {
        return call_expression.arguments.is_empty()
            && r3f_webgpu_api_call_matches(call_expression, "useThree", analysis, ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    let Some(initializer) =
        binding_pattern_initializer_for_symbol(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    r3f_webgpu_is_use_three_result(initializer, analysis, ctx, visited_symbol_ids)
}

fn r3f_webgpu_find_callback_gl_read(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    let first_parameter = r3f_webgpu_callback_first_parameter(callback_id, ctx);
    let parameter_pattern = r3f_webgpu_unwrap_assignment_pattern(first_parameter);
    if let Some(gl_property) = parameter_pattern.and_then(r3f_webgpu_find_gl_property) {
        return Some(gl_property.span());
    }
    let body_span = r3f_webgpu_callback_body_span(callback_id, ctx)?;
    for &candidate_id in node_index.node_ids(callback_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let candidate_span = candidate.span();
        if candidate_span.start < body_span.start || candidate_span.end > body_span.end {
            continue;
        }
        if let Some(object) = r3f_webgpu_gl_member_object(candidate)
            && r3f_webgpu_is_callback_state_object(object, callback_id, ctx, &mut Vec::new())
        {
            return Some(candidate_span);
        }
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        if declarator.init.is_none() {
            continue;
        }
        let Some(gl_property) = r3f_webgpu_find_gl_property(&declarator.id) else {
            continue;
        };
        let Some(gl_symbol_id) = r3f_webgpu_binding_symbol_id(&gl_property.value) else {
            continue;
        };
        if r3f_webgpu_callback_state_property_symbol_matches(
            gl_symbol_id,
            callback_id,
            "gl",
            ctx,
            &mut Vec::new(),
        ) {
            return Some(gl_property.span());
        }
    }
    None
}

fn r3f_webgpu_callback_state_property_matches<'a>(
    expression: &Expression<'a>,
    callback_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression()
        && static_member_expression_property_name(member_expression) == Some(property_name)
    {
        return r3f_webgpu_is_callback_state_object(
            member_expression.object(),
            callback_id,
            ctx,
            &mut visited_symbol_ids.clone(),
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    r3f_webgpu_callback_state_property_symbol_matches(
        symbol_id,
        callback_id,
        property_name,
        ctx,
        visited_symbol_ids,
    )
}

fn r3f_webgpu_callback_state_property_symbol_matches<'a>(
    symbol_id: SymbolId,
    callback_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if r3f_webgpu_callback_parameter_property_matches(callback_id, symbol_id, property_name, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let is_const = matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    );
    if is_const
        && !ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        visited_symbol_ids.push(symbol_id);
        if binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .is_some_and(|initializer| {
            r3f_webgpu_callback_state_property_matches(
                initializer,
                callback_id,
                property_name,
                ctx,
                visited_symbol_ids,
            )
        }) {
            return true;
        }
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    r3f_webgpu_pattern_has_property_binding(&declarator.id, symbol_id, property_name)
        && r3f_webgpu_is_callback_state_object(
            initializer,
            callback_id,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
}

fn r3f_webgpu_is_callback_state_object<'a>(
    expression: &Expression<'a>,
    callback_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if r3f_webgpu_callback_parameter_symbol(callback_id, ctx) == Some(symbol_id) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    let Some(initializer) =
        binding_pattern_initializer_for_symbol(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    r3f_webgpu_is_callback_state_object(initializer, callback_id, ctx, visited_symbol_ids)
}

fn r3f_webgpu_callback_parameter_property_matches(
    callback_id: NodeId,
    symbol_id: SymbolId,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let parameter =
        r3f_webgpu_unwrap_assignment_pattern(r3f_webgpu_callback_first_parameter(callback_id, ctx));
    parameter.is_some_and(|pattern| {
        r3f_webgpu_pattern_has_property_binding(pattern, symbol_id, property_name)
    })
}

fn r3f_webgpu_pattern_has_property_binding(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
    property_name: &str,
) -> bool {
    let BindingPattern::ObjectPattern(pattern) = pattern else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        r3f_webgpu_property_key_matches(property, property_name)
            && r3f_webgpu_binding_symbol_id(&property.value) == Some(symbol_id)
    })
}

fn r3f_webgpu_callback_parameter_symbol(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    r3f_webgpu_binding_symbol_id(r3f_webgpu_unwrap_assignment_pattern(
        r3f_webgpu_callback_first_parameter(callback_id, ctx),
    )?)
}

fn r3f_webgpu_callback_first_parameter<'a, 'b>(
    callback_id: NodeId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b BindingPattern<'a>> {
    match ctx.nodes().get_node(callback_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()
            .map(|parameter| &parameter.pattern),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()
            .map(|parameter| &parameter.pattern),
        _ => None,
    }
}

fn r3f_webgpu_callback_body_span(callback_id: NodeId, ctx: &LintContext<'_>) -> Option<Span> {
    match ctx.nodes().get_node(callback_id).kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span),
        AstKind::ArrowFunctionExpression(function) => Some(
            function
                .get_expression()
                .map_or(function.body.span(), GetSpan::span),
        ),
        _ => None,
    }
}

fn r3f_webgpu_unwrap_assignment_pattern<'a>(
    pattern: Option<&'a BindingPattern<'a>>,
) -> Option<&'a BindingPattern<'a>> {
    match pattern? {
        BindingPattern::AssignmentPattern(assignment) => Some(&assignment.left),
        pattern => Some(pattern),
    }
}

fn r3f_webgpu_binding_symbol_id(pattern: &BindingPattern<'_>) -> Option<SymbolId> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => {
            r3f_webgpu_binding_symbol_id(&assignment.left)
        }
        _ => None,
    }
}

fn r3f_webgpu_find_gl_property<'a>(
    pattern: &'a BindingPattern<'a>,
) -> Option<&'a oxc_ast::ast::BindingProperty<'a>> {
    let BindingPattern::ObjectPattern(pattern) = pattern else {
        return None;
    };
    pattern
        .properties
        .iter()
        .find(|property| r3f_webgpu_property_key_matches(property, "gl"))
}

fn r3f_webgpu_property_key_matches(
    property: &oxc_ast::ast::BindingProperty<'_>,
    property_name: &str,
) -> bool {
    let static_property_name = if property.computed {
        match &property.key {
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
                template.quasis.first().map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                })
            }
            _ => None,
        }
    } else {
        match &property.key {
            PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        }
    };
    static_property_name == Some(property_name)
}
