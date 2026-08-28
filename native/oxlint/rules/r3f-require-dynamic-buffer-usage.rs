use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This R3F BufferAttribute uploads every frame without a dynamic or stream usage prop, so it retains Three.js's StaticDrawUsage strategy";
const R3F_DYNAMIC_BUFFER_USAGE_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const THREE_DYNAMIC_BUFFER_USAGE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const DYNAMIC_BUFFER_USAGE_NAMES: [&str; 6] = [
    "DynamicCopyUsage",
    "DynamicDrawUsage",
    "DynamicReadUsage",
    "StreamCopyUsage",
    "StreamDrawUsage",
    "StreamReadUsage",
];

#[derive(Debug, Default, Clone)]
pub struct R3FRequireDynamicBufferUsage;

impl RuleMeta for R3FRequireDynamicBufferUsage {
    const NAME: &'static str = "r3f-require-dynamic-buffer-usage";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require dynamic usage for R3F buffers uploaded every frame.",
    };
}

impl Rule for R3FRequireDynamicBufferUsage {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let buffer_ref_usages = r3f_dynamic_buffer_collect_ref_usages(&analysis, ctx);
        if buffer_ref_usages.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_DYNAMIC_BUFFER_USAGE_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_DYNAMIC_BUFFER_USAGE_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
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
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) || !analyzed_callback_ids.insert(callback_id)
            {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, is_conditionally_executed, _| {
                    if is_conditionally_executed {
                        return;
                    }
                    let Some(receiver) = r3f_dynamic_buffer_needs_update_receiver(candidate) else {
                        return;
                    };
                    if r3f_dynamic_buffer_managed_ref_usage(receiver, &buffer_ref_usages, ctx)
                        != Some(false)
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

fn r3f_dynamic_buffer_collect_ref_usages<'a>(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> rustc_hash::FxHashMap<oxc_semantic::SymbolId, bool> {
    let mut usages = rustc_hash::FxHashMap::default();
    for node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if !is_r3f_host_intrinsic(opening_element, ctx)
            || !resolve_jsx_element_type(opening_element, ctx).is_some_and(|(element_type, _)| {
                element_type
                    .to_ascii_lowercase()
                    .ends_with("bufferattribute")
            })
        {
            continue;
        }
        let Some(Expression::Identifier(ref_identifier)) =
            get_authoritative_jsx_attribute(opening_element, "ref", true)
                .and_then(jsx_attribute_expression)
        else {
            continue;
        };
        let Some(ref_symbol_id) =
            r3f_dynamic_buffer_const_identifier_alias_symbol(ref_identifier, ctx)
        else {
            continue;
        };
        let is_dynamic = get_authoritative_jsx_attribute(opening_element, "usage", true)
            .and_then(jsx_attribute_expression)
            .is_some_and(|usage_expression| {
                r3f_dynamic_buffer_is_dynamic_usage_expression(usage_expression, analysis, ctx)
            });
        usages.insert(ref_symbol_id, is_dynamic);
    }
    usages
}

fn r3f_dynamic_buffer_const_identifier_alias_symbol<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_id);
    };
    let is_const_declaration = matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    );
    (!is_const_declaration
        || declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id))
    .then_some(symbol_id)
}

fn r3f_dynamic_buffer_is_dynamic_usage_expression<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    DYNAMIC_BUFFER_USAGE_NAMES.iter().any(|usage_name| {
        module_api_reference_matches(
            expression,
            usage_name,
            &THREE_DYNAMIC_BUFFER_USAGE_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            expression,
            usage_name,
            &THREE_DYNAMIC_BUFFER_USAGE_MODULES,
            analysis,
            ctx,
        )
    })
}

fn r3f_dynamic_buffer_needs_update_receiver<'a>(
    node: &crate::AstNode<'a>,
) -> Option<&'a Expression<'a>> {
    let AstKind::AssignmentExpression(assignment_expression) = node.kind() else {
        return None;
    };
    if assignment_expression.operator != AssignmentOperator::Assign
        || !matches!(
            assignment_expression.right.get_inner_expression(),
            Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
        )
    {
        return None;
    }
    let needs_update_member = assignment_expression
        .left
        .as_member_expression()
        .or_else(|| {
            assignment_expression
                .left
                .get_expression()?
                .get_inner_expression()
                .as_member_expression()
        })?;
    (static_member_expression_property_name(needs_update_member) == Some("needsUpdate"))
        .then(|| needs_update_member.object())
}

fn r3f_dynamic_buffer_managed_ref_usage<'a>(
    expression: &Expression<'a>,
    usages: &rustc_hash::FxHashMap<oxc_semantic::SymbolId, bool>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let current_member = expression.get_inner_expression().as_member_expression()?;
    if static_member_expression_property_name(current_member) != Some("current") {
        return None;
    }
    let Expression::Identifier(ref_identifier) = current_member.object().get_inner_expression()
    else {
        return None;
    };
    let ref_symbol_id = r3f_dynamic_buffer_const_identifier_alias_symbol(ref_identifier, ctx)?;
    usages.get(&ref_symbol_id).copied()
}
